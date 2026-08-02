// Vikunja is a to-do list application to facilitate your life.
// Copyright 2018-present Vikunja and contributors. All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package cmd

import (
	"fmt"
	"os"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(webpushKeysCmd)
}

// No PreRun: key generation touches neither the config nor the database, so
// this works before Vikunja is set up at all.
var webpushKeysCmd = &cobra.Command{
	Use:   "webpush-keys",
	Short: "Generate a VAPID key pair for Web Push notifications",
	Long: `Generates the VAPID key pair Web Push notifications are signed with and prints
it as a config snippet.

Keep the pair stable: every device subscribes against the public key, so
rotating it silently invalidates all existing subscriptions and users have to
re-subscribe from their settings.`,
	Args: cobra.NoArgs,
	Run: func(_ *cobra.Command, _ []string) {
		private, public, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Could not generate VAPID keys: %s\n", err)
			os.Exit(1)
		}

		fmt.Println("Add the following to your config.yml:")
		fmt.Println()
		fmt.Println("webpush:")
		fmt.Println("  enabled: true")
		fmt.Printf("  publickey: %s\n", public)
		fmt.Printf("  privatekey: %s\n", private)
		fmt.Println()
		fmt.Println("Keep the private key secret, and do not change either key once devices have subscribed.")
	},
}
