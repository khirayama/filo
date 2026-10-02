import Foundation
import Testing
@testable import Filo

struct SharedURLInboxTests {
    private func withDefaults(_ body: (UserDefaults) throws -> Void) throws {
        let name = "filo.tests.shared-inbox.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        try body(defaults)
    }

    @Test func consecutiveSharesAreDeliveredInOrder() throws {
        try withDefaults { defaults in
            SharedURLInbox.store("https://example.com/first", defaults: defaults)
            SharedURLInbox.store("https://example.com/second", defaults: defaults)
            #expect(SharedURLInbox.take(defaults: defaults) == "https://example.com/first")
            #expect(SharedURLInbox.take(defaults: defaults) == "https://example.com/second")
            #expect(SharedURLInbox.take(defaults: defaults) == nil)
        }
    }

    @Test func repeatedShareDoesNotAddAnotherPendingConfirmation() throws {
        try withDefaults { defaults in
            SharedURLInbox.store("https://example.com/article", defaults: defaults)
            SharedURLInbox.store("https://example.com/article", defaults: defaults)
            #expect(SharedURLInbox.take(defaults: defaults) == "https://example.com/article")
            #expect(SharedURLInbox.take(defaults: defaults) == nil)
        }
    }

    @Test func pendingURLFromPreviousVersionIsPreserved() throws {
        try withDefaults { defaults in
            defaults.set("https://example.com/old", forKey: "filo.pendingSharedURL")
            SharedURLInbox.store("https://example.com/new", defaults: defaults)
            #expect(SharedURLInbox.take(defaults: defaults) == "https://example.com/old")
            #expect(SharedURLInbox.take(defaults: defaults) == "https://example.com/new")
        }
    }
}
