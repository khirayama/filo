import FirebaseCore
import SwiftUI

@main
struct FiloApp: App {
    init() {
        FirebaseApp.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(BetterAuth.shared)
        }
    }
}
