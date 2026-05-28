package discovery

// Category catalogue. Each detected service is tagged with one category
// slug; the curate UI shows it (editable per row) and the promote
// handler uses it to distribute tiles across dashboard groups
// automatically — "Sonarr" goes to the "Downloads" group, "Pi-hole" to
// "Network", etc. — without the admin having to pick a target group
// per result.
//
// The slug is the canonical identifier (stable across versions, used in
// raw_fingerprint and the API). The display name + icon are what the
// promote handler uses when creating a new group from a category.
//
// Phase 4 (GUI-managed detectors) will let admins add their own
// categories via the admin UI. Until then this list is the authoritative
// set; rows from outside it default to CategoryOther.

const (
	CategoryNetwork        = "network"
	CategoryAutomation     = "automation"
	CategoryMedia          = "media"
	CategoryDownloads      = "downloads"
	CategoryStorage        = "storage"
	CategorySurveillance   = "surveillance"
	CategoryMonitoring     = "monitoring"
	CategoryVirtualization = "virtualization"
	CategoryPhotos         = "photos"
	CategoryDocuments      = "documents"
	CategoryCode           = "code"
	CategoryAuth           = "auth"
	CategoryNotifications  = "notifications"
	CategoryIoT            = "iot"
	CategoryOther          = "other"
)

// CategoryInfo describes one category for display + group-creation
// purposes. DisplayName is what shows up as the group name when promote
// auto-creates a group; Icon is what the new group gets as its icon
// (mdi-style — these don't need to be in the dashboard-icons bundle).
type CategoryInfo struct {
	Slug        string
	DisplayName string
	Icon        string
}

// categoryCatalogue is the canonical list. Order here is the display
// order in dropdowns — alphabetical by display name so admins can find
// entries quickly. ("Other" sits naturally between Notifications and
// Photos.)
var categoryCatalogue = []CategoryInfo{
	{CategoryAuth, "Authentication", "mdi:lock"},
	{CategoryCode, "Code", "mdi:source-branch"},
	{CategoryDocuments, "Documents", "mdi:file-document"},
	{CategoryDownloads, "Downloads", "mdi:download"},
	{CategoryIoT, "IoT", "mdi:chip"},
	{CategoryMedia, "Media", "mdi:play-circle"},
	{CategoryMonitoring, "Monitoring", "mdi:monitor-dashboard"},
	{CategoryNetwork, "Network", "mdi:lan"},
	{CategoryNotifications, "Notifications", "mdi:bell"},
	{CategoryOther, "Other", "mdi:application"},
	{CategoryPhotos, "Photos", "mdi:image-multiple"},
	{CategoryAutomation, "Smart Home", "mdi:home-automation"},
	{CategoryStorage, "Storage", "mdi:nas"},
	{CategorySurveillance, "Surveillance", "mdi:cctv"},
	{CategoryVirtualization, "Virtualization", "mdi:server"},
}

// CategoryCatalogue returns a copy of the catalogue (for API exposure).
func CategoryCatalogue() []CategoryInfo {
	out := make([]CategoryInfo, len(categoryCatalogue))
	copy(out, categoryCatalogue)
	return out
}

// CategoryInfoFor returns the catalogue entry for a slug, or the "other"
// entry if the slug isn't recognised (covers legacy rows / typos / Phase
// 4 categories that haven't been added to the catalogue yet).
func CategoryInfoFor(slug string) CategoryInfo {
	for _, c := range categoryCatalogue {
		if c.Slug == slug {
			return c
		}
	}
	return CategoryInfo{Slug: CategoryOther, DisplayName: "Other", Icon: "mdi:application"}
}

// IsValidCategory reports whether the slug is in the catalogue. Used at
// API edges where untrusted input lands (PATCH curate state, etc.).
func IsValidCategory(slug string) bool {
	for _, c := range categoryCatalogue {
		if c.Slug == slug {
			return true
		}
	}
	return false
}

// categoryForMDNSService maps mDNS service-type names to a category so
// passive mDNS results carry the same auto-grouping signal as active
// HTTP-fingerprint results.
func categoryForMDNSService(serviceType string) string {
	switch serviceType {
	case "_homeassistant._tcp.local.", "_hap._tcp.local.":
		return CategoryAutomation
	case "_airplay._tcp.local.", "_raop._tcp.local.",
		"_googlecast._tcp.local.", "_plex._tcp.local.":
		return CategoryMedia
	case "_smb._tcp.local.":
		return CategoryStorage
	case "_printer._tcp.local.", "_ipp._tcp.local.":
		return CategoryDocuments
	case "_ssh._tcp.local.", "_workstation._tcp.local.":
		return CategoryOther
	default:
		return CategoryOther
	}
}
