import SwiftUI
import UIKit

// The SVG data is copied verbatim from apps/web/src/components/icons.tsx so
// both platforms draw the same glyphs. Keep them identical when an icon is
// added or changed on the web.
enum FiloIconName: Hashable {
    case menu
    case plus
    case star
    case bookmark
    case checkCircle
    case refresh
    case externalLink
    case chevronRight
    case chevronDown
    case chevronUp
    case tag
    case gear
    case list
    case queueAdd
    case inbox
    case playlist
    case rss
    case activity
    case pencil
    case bookOpen
    case back
    case more
    case close
    case play
    case pause
    case trash
    case translate

    fileprivate var elements: [SVGElement] {
        switch self {
        case .menu: return [.path("M3 6h18"), .path("M3 12h18"), .path("M3 18h18")]
        case .plus: return [.path("M12 5v14"), .path("M5 12h14")]
        case .star: return [.polygon("12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2")]
        case .bookmark: return [.path("M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z")]
        case .checkCircle: return [.circle(12, 12, 9), .path("M16 9.5l-5 5-2.5-2.5")]
        case .refresh: return [.path("M23 4v6h-6"), .path("M20.49 15a9 9 0 1 1-2.12-9.36L23 10")]
        case .externalLink:
            return [
                .path("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"),
                .path("M15 3h6v6"),
                .path("M10 14L21 3"),
            ]
        case .chevronRight: return [.path("M9 18l6-6-6-6")]
        case .chevronDown: return [.path("M6 9l6 6 6-6")]
        case .chevronUp: return [.path("M18 15l-6-6-6 6")]
        case .tag:
            return [
                .path("M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"),
                .path("M7 7h.01"),
            ]
        case .gear:
            return [
                .circle(12, 12, 3),
                .path("M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"),
            ]
        case .list:
            return [
                .path("M8 6h13"), .path("M8 12h13"), .path("M8 18h13"),
                .path("M3 6h.01"), .path("M3 12h.01"), .path("M3 18h.01"),
            ]
        case .queueAdd:
            return [.path("M3 6h13"), .path("M3 12h13"), .path("M3 18h9"), .path("M18 15v6"), .path("M15 18h6")]
        case .inbox:
            return [
                .path("M22 12h-6l-2 3h-4l-2-3H2"),
                .path("M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"),
            ]
        case .playlist:
            return [.path("M3 6h13"), .path("M3 12h9"), .path("M3 18h7"), .path("M15 13.5v7l5.5-3.5z")]
        case .rss: return [.path("M4 11a9 9 0 0 1 9 9"), .path("M4 4a16 16 0 0 1 16 16"), .circle(5, 19, 1)]
        case .activity: return [.path("M22 12h-4l-3 9L9 3l-3 9H2")]
        case .pencil: return [.path("M12 20h9"), .path("M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z")]
        case .bookOpen:
            return [.path("M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"), .path("M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z")]
        case .back: return [.path("M19 12H5"), .path("M12 19l-7-7 7-7")]
        case .more: return [.circle(12, 12, 1.5), .circle(19, 12, 1.5), .circle(5, 12, 1.5)]
        case .close: return [.path("M18 6L6 18"), .path("M6 6l12 12")]
        case .play: return [.polygon("6 4 20 12 6 20 6 4")]
        case .pause: return [.path("M6 4h4v16H6z"), .path("M14 4h4v16h-4z")]
        case .trash:
            return [
                .path("M3 6h18"),
                .path("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"),
                .path("M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"),
            ]
        case .translate:
            return [
                .path("M4 5h7"), .path("M7.5 5v1c0 2.5-1.5 4.5-3.5 5.5"), .path("M4.5 8c1.5 1 3 2.5 3.5 4.5"),
                .path("M14 14l2 6"), .path("M20 14l-2 6"), .path("M15 17h4"), .path("M12 12l4-4"),
            ]
        }
    }

    // Parsed once per icon, in the 24×24 viewBox.
    @MainActor private static var pathCache: [FiloIconName: Path] = [:]

    @MainActor fileprivate var path: Path {
        if let cached = Self.pathCache[self] { return cached }
        var path = Path()
        for element in elements { element.append(to: &path) }
        Self.pathCache[self] = path
        return path
    }
}

private struct FiloIconShape: Shape {
    let path: Path

    func path(in rect: CGRect) -> Path {
        path.applying(
            CGAffineTransform(translationX: rect.minX, y: rect.minY)
                .scaledBy(x: rect.width / 24, y: rect.height / 24)
        )
    }
}

// Draws like the web <Icon>: a 1.8 stroke in the 24-unit viewBox, round caps
// and joins, filled with the same color when `filled`. Without an explicit
// color it inherits the foreground style (the web's currentColor).
struct FiloIcon: View {
    let name: FiloIconName
    var size: CGFloat = 18
    var color: Color?
    var filled = false

    init(_ name: FiloIconName, size: CGFloat = 18, color: Color? = nil, filled: Bool = false) {
        self.name = name
        self.size = size
        self.color = color
        self.filled = filled
    }

    var body: some View {
        let shape = FiloIconShape(path: name.path)
        let glyph = ZStack {
            if filled { shape.fill() }
            shape.stroke(style: StrokeStyle(lineWidth: 1.8 * size / 24, lineCap: .round, lineJoin: .round))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        if let color {
            glyph.foregroundStyle(color)
        } else {
            glyph
        }
    }
}

extension Image {
    // UIKit-backed menus only render Image, so menu items get the same glyph
    // rasterized as a template image.
    @MainActor
    init(filoIcon name: FiloIconName, size: CGFloat = 18) {
        let renderer = ImageRenderer(content: FiloIcon(name, size: size, color: .black))
        renderer.scale = UITraitCollection.current.displayScale
        let image = renderer.uiImage?.withRenderingMode(.alwaysTemplate) ?? UIImage()
        self.init(uiImage: image)
    }
}

// MARK: - SVG geometry

private enum SVGElement {
    case path(String)
    case circle(CGFloat, CGFloat, CGFloat)
    case polygon(String)

    func append(to path: inout Path) {
        switch self {
        case .path(let data):
            SVGPathParser(data).append(to: &path)
        case .circle(let cx, let cy, let r):
            path.addEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
        case .polygon(let points):
            let values = SVGPathParser.numbers(in: points)
            guard values.count >= 4 else { return }
            path.move(to: CGPoint(x: values[0], y: values[1]))
            var index = 2
            while index + 1 < values.count {
                path.addLine(to: CGPoint(x: values[index], y: values[index + 1]))
                index += 2
            }
            path.closeSubpath()
        }
    }
}

// Supports the path commands the icon set uses: M L H V C S A Z, absolute and
// relative. Arcs are converted to cubic Béziers.
private struct SVGPathParser {
    private let tokens: [Token]

    private enum Token {
        case command(Character)
        case number(CGFloat)
    }

    init(_ data: String) {
        var tokens: [Token] = []
        var number = ""
        func flush() {
            if let value = Double(number) { tokens.append(.number(CGFloat(value))) }
            number = ""
        }
        for character in data {
            if character.isLetter && character != "e" {
                flush()
                tokens.append(.command(character))
            } else if character == "-" && !number.isEmpty && number.last != "e" {
                flush()
                number = "-"
            } else if character == "." && number.contains(".") {
                flush()
                number = "."
            } else if character.isNumber || character == "." || character == "-" || character == "e" {
                number.append(character)
            } else {
                flush()
            }
        }
        flush()
        self.tokens = tokens
    }

    static func numbers(in text: String) -> [CGFloat] {
        SVGPathParser("M" + text).tokens.compactMap {
            if case .number(let value) = $0 { return value } else { return nil }
        }
    }

    func append(to path: inout Path) {
        var index = 0
        var command: Character = "M"
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?

        func next() -> CGFloat {
            guard index < tokens.count, case .number(let value) = tokens[index] else { return 0 }
            index += 1
            return value
        }
        func hasNumber() -> Bool {
            guard index < tokens.count, case .number = tokens[index] else { return false }
            return true
        }

        while index < tokens.count {
            if case .command(let value) = tokens[index] {
                command = value
                index += 1
            }
            let relative = command.isLowercase
            let origin = relative ? current : .zero
            switch command.uppercased() {
            case "M":
                current = CGPoint(x: origin.x + next(), y: origin.y + next())
                start = current
                path.move(to: current)
                // Further pairs after a moveto are implicit linetos.
                command = relative ? "l" : "L"
                lastControl = nil
            case "L":
                current = CGPoint(x: origin.x + next(), y: origin.y + next())
                path.addLine(to: current)
                lastControl = nil
            case "H":
                current = CGPoint(x: (relative ? current.x : 0) + next(), y: current.y)
                path.addLine(to: current)
                lastControl = nil
            case "V":
                current = CGPoint(x: current.x, y: (relative ? current.y : 0) + next())
                path.addLine(to: current)
                lastControl = nil
            case "C":
                let c1 = CGPoint(x: origin.x + next(), y: origin.y + next())
                let c2 = CGPoint(x: origin.x + next(), y: origin.y + next())
                current = CGPoint(x: origin.x + next(), y: origin.y + next())
                path.addCurve(to: current, control1: c1, control2: c2)
                lastControl = c2
            case "S":
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = CGPoint(x: origin.x + next(), y: origin.y + next())
                current = CGPoint(x: origin.x + next(), y: origin.y + next())
                path.addCurve(to: current, control1: c1, control2: c2)
                lastControl = c2
            case "A":
                let rx = next(), ry = next(), rotation = next()
                let largeArc = next() != 0, sweep = next() != 0
                let end = CGPoint(x: origin.x + next(), y: origin.y + next())
                addArc(to: &path, from: current, to: end, rx: rx, ry: ry, rotation: rotation, largeArc: largeArc, sweep: sweep)
                current = end
                lastControl = nil
            case "Z":
                path.closeSubpath()
                current = start
                lastControl = nil
                // A closepath takes no arguments; stop numbers from looping here.
                if hasNumber() { index += 1 }
            default:
                index += 1
            }
        }
    }

    // Endpoint-to-center arc conversion (SVG 1.1 implementation notes F.6.5).
    private func addArc(
        to path: inout Path,
        from p0: CGPoint,
        to p1: CGPoint,
        rx rxIn: CGFloat,
        ry ryIn: CGFloat,
        rotation: CGFloat,
        largeArc: Bool,
        sweep: Bool,
    ) {
        guard p0 != p1 else { return }
        var rx = abs(rxIn), ry = abs(ryIn)
        guard rx > 0, ry > 0 else { path.addLine(to: p1); return }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 = cosPhi * dx + sinPhi * dy
        let y1 = -sinPhi * dx + cosPhi * dy
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 {
            rx *= sqrt(lambda)
            ry *= sqrt(lambda)
        }
        let numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
        var coefficient = sqrt(max(0, numerator / denominator))
        if largeArc == sweep { coefficient = -coefficient }
        let cx1 = coefficient * rx * y1 / ry
        let cy1 = -coefficient * ry * x1 / rx
        let cx = cosPhi * cx1 - sinPhi * cy1 + (p0.x + p1.x) / 2
        let cy = sinPhi * cx1 + cosPhi * cy1 + (p0.y + p1.y) / 2

        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let sign: CGFloat = ux * vy - uy * vx < 0 ? -1 : 1
            let dot = (ux * vx + uy * vy) / (sqrt(ux * ux + uy * uy) * sqrt(vx * vx + vy * vy))
            return sign * acos(min(1, max(-1, dot)))
        }
        let theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
        var delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }

        let segments = Int(ceil(abs(delta) / (.pi / 2)))
        let step = delta / CGFloat(segments)
        let k = 4.0 / 3.0 * tan(step / 4)
        func point(_ t: CGFloat) -> CGPoint {
            CGPoint(
                x: cx + rx * cos(t) * cosPhi - ry * sin(t) * sinPhi,
                y: cy + rx * cos(t) * sinPhi + ry * sin(t) * cosPhi,
            )
        }
        func derivative(_ t: CGFloat) -> CGPoint {
            CGPoint(
                x: -rx * sin(t) * cosPhi - ry * cos(t) * sinPhi,
                y: -rx * sin(t) * sinPhi + ry * cos(t) * cosPhi,
            )
        }
        var t = theta1
        for _ in 0..<segments {
            let t2 = t + step
            let a = point(t), b = point(t2)
            let da = derivative(t), db = derivative(t2)
            path.addCurve(
                to: b,
                control1: CGPoint(x: a.x + k * da.x, y: a.y + k * da.y),
                control2: CGPoint(x: b.x - k * db.x, y: b.y - k * db.y),
            )
            t = t2
        }
    }
}
