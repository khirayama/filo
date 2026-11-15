import XCTest
@testable import Filo

final class URLSafetyTests: XCTestCase {
    func testAllowsOnlyHTTPAndHTTPS() {
        XCTAssertEqual(safeHttpURL("https://example.com/article")?.absoluteString, "https://example.com/article")
        XCTAssertEqual(safeHttpURL("http://example.com/article")?.absoluteString, "http://example.com/article")
        XCTAssertNil(safeHttpURL("javascript:alert(1)"))
        XCTAssertNil(safeHttpURL("data:text/html,hello"))
        XCTAssertNil(safeHttpURL("file:///etc/passwd"))
        XCTAssertNil(safeHttpURL("mailto:a@example.com"))
        XCTAssertNil(safeHttpURL("/relative"))
    }

    func testAllowsOnlySafeWebViewNavigations() {
        XCTAssertTrue(isAllowedWebNavigation("https://example.com/article"))
        XCTAssertTrue(isAllowedWebNavigation("about:blank"))
        XCTAssertFalse(isAllowedWebNavigation("javascript:alert(1)"))
        XCTAssertFalse(isAllowedWebNavigation("file:///etc/passwd"))
        XCTAssertFalse(isAllowedWebNavigation("mailto:a@example.com"))
    }
}
