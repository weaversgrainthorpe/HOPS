package main

import (
	"fmt"
	"os"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: hashpw <password>")
		os.Exit(1)
	}

	password := os.Args[1]

	// Test the hardcoded hash first
	testHash := "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
	err := bcrypt.CompareHashAndPassword([]byte(testHash), []byte(password))
	if err == nil {
		fmt.Println("Password matches the existing hash!")
	} else {
		fmt.Println("Password does NOT match existing hash")
	}

	// Generate new hash
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("New hash: %s\n", string(hash))
}
