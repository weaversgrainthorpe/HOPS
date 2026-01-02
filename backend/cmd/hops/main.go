package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/yourusername/hops/internal/api"
	"github.com/yourusername/hops/internal/auth"
	"github.com/yourusername/hops/internal/config"
	"github.com/yourusername/hops/internal/database"
	"github.com/yourusername/hops/internal/version"
)

func main() {
	// Command line flags
	port := flag.String("port", "8080", "Port to run the server on")
	dataDir := flag.String("data", "../data", "Data directory for SQLite database")
	frontendDir := flag.String("frontend", "../frontend/build", "Frontend build directory")
	flag.Parse()

	// Initialize configuration
	cfg := &config.Config{
		Port:        *port,
		DataDir:     *dataDir,
		FrontendDir: *frontendDir,
	}

	// Ensure data directory exists
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}

	// Initialize database
	dbPath := filepath.Join(cfg.DataDir, "hops.db")
	db, err := database.Initialize(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Initialize auth service
	authService := auth.NewService(db)

	// Initialize API router
	router := api.NewRouter(db, authService, cfg)

	// Start server
	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("%s starting on %s", version.Full(), addr)
	log.Printf("Data directory: %s", cfg.DataDir)
	log.Printf("Frontend directory: %s", cfg.FrontendDir)

	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
