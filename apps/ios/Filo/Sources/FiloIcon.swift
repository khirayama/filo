import SwiftUI

// Geometry mirrors apps/web/src/components/icons.tsx. Keep these names and
// paths in sync when an icon is added or changed on the web.
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
    case back
    case more
    case close
    case play
    case pause
    case trash
    case translate
}

struct FiloIcon: View {
    let name: FiloIconName
    var size: CGFloat = 18
    var color: Color = FiloPalette.muted
    var filled = false

    init(_ name: FiloIconName, size: CGFloat = 18, color: Color = FiloPalette.muted, filled: Bool = false) {
        self.name = name
        self.size = size
        self.color = color
        self.filled = filled
    }

    var body: some View {
        Canvas { context, _ in
            context.scaleBy(x: size / 24, y: size / 24)
            let path = Self.path(for: name)
            if filled {
                context.fill(path, with: .color(color))
            }
            context.stroke(
                path,
                with: .color(color),
                style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round),
            )
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private static func path(for name: FiloIconName) -> Path {
        var path = Path()
        switch name {
        case .menu:
            line(&path, 3, 6, 21, 6)
            line(&path, 3, 12, 21, 12)
            line(&path, 3, 18, 21, 18)
        case .plus:
            line(&path, 12, 5, 12, 19)
            line(&path, 5, 12, 19, 12)
        case .star:
            polygon(&path, [(12, 2), (15.09, 8.26), (22, 9.27), (17, 14.14), (18.18, 21.02), (12, 17.77), (5.82, 21.02), (7, 14.14), (2, 9.27), (8.91, 8.26)])
        case .bookmark:
            path.move(to: point(19, 21))
            path.addLine(to: point(12, 16))
            path.addLine(to: point(5, 21))
            path.addLine(to: point(5, 5))
            path.addCurve(to: point(7, 3), control1: point(5, 3.9), control2: point(5.9, 3))
            path.addLine(to: point(17, 3))
            path.addCurve(to: point(19, 5), control1: point(19, 3.9), control2: point(19, 3.9))
            path.closeSubpath()
        case .checkCircle:
            path.addEllipse(in: CGRect(x: 3, y: 3, width: 18, height: 18))
            path.move(to: point(16, 9.5))
            path.addLine(to: point(11, 14.5))
            path.addLine(to: point(8.5, 12))
        case .refresh:
            path.move(to: point(23, 4))
            path.addLine(to: point(23, 10))
            path.addLine(to: point(17, 10))
            path.move(to: point(20.49, 15))
            path.addArc(center: point(12, 12), radius: 9, startAngle: .degrees(19.47), endAngle: .degrees(315.07), clockwise: false)
            path.addLine(to: point(23, 10))
        case .externalLink:
            path.move(to: point(18, 13))
            path.addLine(to: point(18, 19))
            path.addCurve(to: point(16, 21), control1: point(18, 20.1), control2: point(17.1, 21))
            path.addLine(to: point(5, 21))
            path.addCurve(to: point(3, 19), control1: point(3.9, 21), control2: point(3, 20.1))
            path.addLine(to: point(3, 8))
            path.addCurve(to: point(5, 6), control1: point(3, 6.9), control2: point(3.9, 6))
            path.addLine(to: point(11, 6))
            path.move(to: point(15, 3))
            path.addLine(to: point(21, 3))
            path.addLine(to: point(21, 9))
            path.move(to: point(10, 14))
            path.addLine(to: point(21, 3))
        case .chevronRight:
            path.move(to: point(9, 18))
            path.addLine(to: point(15, 12))
            path.addLine(to: point(9, 6))
        case .chevronDown:
            path.move(to: point(6, 9))
            path.addLine(to: point(12, 15))
            path.addLine(to: point(18, 9))
        case .chevronUp:
            path.move(to: point(18, 15))
            path.addLine(to: point(12, 9))
            path.addLine(to: point(6, 15))
        case .tag:
            path.move(to: point(20.59, 13.41))
            path.addLine(to: point(13.42, 20.58))
            path.addCurve(to: point(10.59, 20.58), control1: point(12.64, 21.36), control2: point(11.37, 21.36))
            path.addLine(to: point(2, 12))
            path.addLine(to: point(2, 2))
            path.addLine(to: point(12, 2))
            path.addLine(to: point(20.59, 10.59))
            path.addCurve(to: point(20.59, 13.41), control1: point(21.37, 11.37), control2: point(21.37, 12.64))
            path.closeSubpath()
            path.move(to: point(7, 7))
            path.addLine(to: point(7.01, 7))
        case .gear:
            gearPath(&path)
        case .list:
            line(&path, 8, 6, 21, 6)
            line(&path, 8, 12, 21, 12)
            line(&path, 8, 18, 21, 18)
            line(&path, 3, 6, 3.01, 6)
            line(&path, 3, 12, 3.01, 12)
            line(&path, 3, 18, 3.01, 18)
        case .queueAdd:
            line(&path, 3, 6, 16, 6)
            line(&path, 3, 12, 16, 12)
            line(&path, 3, 18, 12, 18)
            line(&path, 18, 15, 18, 21)
            line(&path, 15, 18, 21, 18)
        case .back:
            line(&path, 19, 12, 5, 12)
            path.move(to: point(12, 19))
            path.addLine(to: point(5, 12))
            path.addLine(to: point(12, 5))
        case .more:
            path.addEllipse(in: CGRect(x: 3.5, y: 10.5, width: 3, height: 3))
            path.addEllipse(in: CGRect(x: 10.5, y: 10.5, width: 3, height: 3))
            path.addEllipse(in: CGRect(x: 17.5, y: 10.5, width: 3, height: 3))
        case .close:
            line(&path, 18, 6, 6, 18)
            line(&path, 6, 6, 18, 18)
        case .play:
            polygon(&path, [(6, 4), (20, 12), (6, 20)])
        case .pause:
            path.move(to: point(6, 4))
            path.addLine(to: point(10, 4))
            path.addLine(to: point(10, 20))
            path.addLine(to: point(6, 20))
            path.closeSubpath()
            path.move(to: point(14, 4))
            path.addLine(to: point(18, 4))
            path.addLine(to: point(18, 20))
            path.addLine(to: point(14, 20))
            path.closeSubpath()
        case .trash:
            line(&path, 3, 6, 21, 6)
            path.move(to: point(8, 6))
            path.addLine(to: point(8, 4))
            path.addCurve(to: point(10, 2), control1: point(8, 2.9), control2: point(8.9, 2))
            path.addLine(to: point(14, 2))
            path.addCurve(to: point(16, 4), control1: point(16, 2.9), control2: point(16, 2.9))
            path.addLine(to: point(16, 6))
            path.move(to: point(19, 6))
            path.addLine(to: point(18, 20))
            path.addCurve(to: point(16, 22), control1: point(17.9, 22), control2: point(17.1, 22))
            path.addLine(to: point(8, 22))
            path.addCurve(to: point(6, 20), control1: point(6.9, 22), control2: point(6.1, 22))
            path.addLine(to: point(5, 6))
        case .translate:
            line(&path, 4, 5, 11, 5)
            path.move(to: point(7.5, 5))
            path.addLine(to: point(7.5, 6))
            path.addCurve(to: point(4, 11.5), control1: point(7.5, 8.5), control2: point(6.1, 10.5))
            path.move(to: point(4.5, 8))
            path.addCurve(to: point(8, 12.5), control1: point(6, 9), control2: point(7.5, 11))
            path.move(to: point(14, 14))
            path.addLine(to: point(16, 20))
            path.move(to: point(20, 14))
            path.addLine(to: point(18, 20))
            line(&path, 15, 17, 19, 17)
            path.move(to: point(12, 12))
            path.addLine(to: point(16, 8))
        }
        return path
    }

    private static func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }

    private static func line(_ path: inout Path, _ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) {
        path.move(to: point(x1, y1))
        path.addLine(to: point(x2, y2))
    }

    private static func polygon(_ path: inout Path, _ points: [(CGFloat, CGFloat)]) {
        guard let first = points.first else { return }
        path.move(to: point(first.0, first.1))
        for item in points.dropFirst() { path.addLine(to: point(item.0, item.1)) }
        path.closeSubpath()
    }

    private static func gearPath(_ path: inout Path) {
        // The web path is a rounded eight-tooth gear. The circular portions
        // are represented with the same 1.65/2 unit radii as the source SVG.
        let center = CGPoint(x: 12, y: 12)
        path.addEllipse(in: CGRect(x: 10.5, y: 10.5, width: 3, height: 3))
        for index in 0..<16 {
            let angle = Double(index) * .pi / 8 - .pi / 2
            let radius: CGFloat = index.isMultiple(of: 2) ? 10 : 8.6
            let p = CGPoint(x: center.x + CGFloat(cos(angle)) * radius, y: center.y + CGFloat(sin(angle)) * radius)
            if index == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
    }
}
