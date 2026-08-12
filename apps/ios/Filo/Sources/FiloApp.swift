import ClerkKit
import ClerkKitUI
import FirebaseCore
import SwiftUI

@main
struct FiloApp: App {
    init() {
        FirebaseApp.configure()
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
