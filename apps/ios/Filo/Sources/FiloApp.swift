import ClerkKit
import ClerkKitUI
import SwiftUI

@main
struct FiloApp: App {
    init() {
        if !ClerkConfiguration.isPlaceholderKey {
            Clerk.configure(publishableKey: ClerkConfiguration.publishableKey)
        }
    }

    var body: some Scene {
        WindowGroup {
            if ClerkConfiguration.isPlaceholderKey {
                MissingConfigurationView()
            } else {
                ContentView()
                    .prefetchClerkImages()
                    .environment(Clerk.shared)
            }
        }
    }
}
