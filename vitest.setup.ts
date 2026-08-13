// Vitest only forwards VITE_-prefixed variables into process.env. Server-side tests
// need the unprefixed secrets too, and widening `envPrefix` would leak them into the
// client bundle, so load the .env file directly for the test run only.
import "dotenv/config";
