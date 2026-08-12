import FirebaseAnalytics

enum FiloAnalytics {
    static func track(_ name: String, parameters: [String: Any] = [:]) {
        Analytics.logEvent(name, parameters: parameters)
    }

    static func screen(_ name: String) {
        track(AnalyticsEventScreenView, parameters: [
            AnalyticsParameterScreenName: name,
            AnalyticsParameterScreenClass: "Filo",
        ])
    }
}
