package api

import (
	"fmt"
	"time"

	"github.com/weaversgrainthorpe/HOPS/internal/status"
)

// SetStatusHealth connects the status checker, whose state is shown to a
// signed-in admin as notices: checks that can't keep up with their interval,
// and results that couldn't be saved. Neither is left to the log alone.
func (r *Router) SetStatusHealth(f func() status.Health) { r.statusHealth = f }

var statusSettingsLink = &noticeLink{Href: "/settings/global#status-checks", Label: "Status check settings"}

// statusNotices are the status checker's sticky warnings: they go by
// themselves once the cause is gone.
func (r *Router) statusNotices(now time.Time) []notice {
	if r.statusHealth == nil {
		return nil
	}
	h := r.statusHealth()
	var out []notice
	if h.SaveError != "" {
		out = append(out, notice{
			ID: "status-save-failed",
			Text: fmt.Sprintf("HOPS couldn't save status check results (since %s: %s). Status badges may be out of date; "+
				"see Settings › Logs. This goes once a save works.", h.SaveErrorAt.Local().Format("15:04"), h.SaveError),
			Level:  "warning",
			Sticky: true,
		})
	}
	if h.Behind(now) {
		var what string
		if h.Running {
			what = fmt.Sprintf("Checking %d tile%s has taken %s so far (%d done), longer than the check interval (%s). Tiles not checked yet show as unknown.",
				h.Total, plural(h.Total), roughDuration(now.Sub(h.Started)), h.Done, roughDuration(h.Interval))
		} else {
			what = fmt.Sprintf("The last round of status checks took %s for %d tile%s, longer than the check interval (%s), so badges update less often than set.",
				roughDuration(h.Took), h.Total, plural(h.Total), roughDuration(h.Interval))
		}
		out = append(out, notice{
			ID: "status-checks-behind",
			Text: what + " Tiles that don't answer slow it down most: each waits for the whole timeout. " +
				"Fix or remove tiles whose service is gone, turn their status checks off, or lower the timeout.",
			Level:  "warning",
			Sticky: true,
			Link:   statusSettingsLink,
		})
	}
	return out
}

// roughDuration says a duration the way a person would: "40 seconds",
// "1 minute", "22 minutes", "1 hour 5 minutes".
func roughDuration(d time.Duration) string {
	if d < time.Minute {
		s := int(d.Round(time.Second) / time.Second)
		return fmt.Sprintf("%d second%s", s, plural(s))
	}
	m := int(d.Round(time.Minute) / time.Minute)
	if m < 60 {
		return fmt.Sprintf("%d minute%s", m, plural(m))
	}
	h, m := m/60, m%60
	if m == 0 {
		return fmt.Sprintf("%d hour%s", h, plural(h))
	}
	return fmt.Sprintf("%d hour%s %d minute%s", h, plural(h), m, plural(m))
}
