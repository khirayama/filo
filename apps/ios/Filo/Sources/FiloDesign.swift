import SwiftUI
import UIKit

// Design tokens and shared components. Values mirror apps/web/src/global.css
// (the --fl-* variables) and components/ui.tsx so every platform shares one
// visual system. Change them together.

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: opacity,
        )
    }

    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
    }
}

extension Text {
    // Resolved against the environment locale at render time, so labels follow
    // a language change without their parent re-evaluating.
    init(localized key: String) {
        self.init(LocalizedStringKey(key))
    }
}

enum FiloPalette {
    static let background = Color(light: Color(hex: 0xFFFFFF), dark: Color(hex: 0x16181C))
    static let sidebar = Color(light: Color(hex: 0xF7F7F8), dark: Color(hex: 0x1B1D22))
    static let surface = Color(light: Color(hex: 0xFFFFFF), dark: Color(hex: 0x1F2227))
    static let text = Color(light: Color(hex: 0x1D1D1F), dark: Color(hex: 0xE6E6E8))
    static let border = Color(light: Color(hex: 0xD4D4D8), dark: Color(hex: 0x41454D))
    static let mutedBorder = Color(light: Color(hex: 0xE7E7EA), dark: Color(hex: 0x2C2F35))
    static let muted = Color(light: Color(hex: 0x6E6E76), dark: Color(hex: 0x9AA0A8))
    static let danger = Color(light: Color(hex: 0xB3261E), dark: Color(hex: 0xEF7B74))
    static let dangerBackground = Color(light: Color(hex: 0xFDECEA), dark: Color(hex: 0x3A1F1E))
    static let accent = Color(light: Color(hex: 0x1A56DB), dark: Color(hex: 0x6A9BFF))
    static let onAccent = Color(light: Color(hex: 0xFFFFFF), dark: Color(hex: 0x10233F))
    static let primary = Color(light: Color(hex: 0x1A56DB), dark: Color(hex: 0x3569D6))
    static let onPrimary = Color(hex: 0xFFFFFF)
    static let star = Color(light: Color(hex: 0xD99400), dark: Color(hex: 0xFFC94D))
    static let ok = Color(light: Color(hex: 0x2F6A3D), dark: Color(hex: 0x6BCB8A))
    static let okBackground = Color(light: Color(hex: 0xE3F6E8), dark: Color(hex: 0x1C3324))
    static let warn = Color(light: Color(hex: 0x8A5D00), dark: Color(hex: 0xE3B341))
    static let warnBackground = Color(light: Color(hex: 0xFDF3D3), dark: Color(hex: 0x38300F))
    static let hover = Color(light: Color(hex: 0x000000, opacity: 0.04), dark: Color(hex: 0xFFFFFF, opacity: 0.05))
    static let pressed = Color(light: Color(hex: 0x000000, opacity: 0.07), dark: Color(hex: 0xFFFFFF, opacity: 0.09))
    static let scrim = Color(light: Color(hex: 0x000000, opacity: 0.3), dark: Color(hex: 0x000000, opacity: 0.5))
    static let shadow = Color(light: Color(hex: 0x000000, opacity: 0.12), dark: Color(hex: 0x000000, opacity: 0.5))
    // color-mix(accent 14%, transparent)
    static let accentSoft = Color(light: Color(hex: 0x1A56DB, opacity: 0.14), dark: Color(hex: 0x6A9BFF, opacity: 0.14))
    // color-mix(text 4%, bg)
    static let rowHover = Color(light: Color(hex: 0xF6F6F6), dark: Color(hex: 0x1E2024))
}

enum FiloMetrics {
    static let gutter: CGFloat = 16
    static let desktopGutter: CGFloat = 24
    static let headerHeight: CGFloat = 52
    static let desktopHeaderHeight: CGFloat = 56
    static let radiusSmall: CGFloat = 6
    static let radius: CGFloat = 8
    static let radiusLarge: CGFloat = 12
    static let controlHeight: CGFloat = 36
    static let controlHeightSmall: CGFloat = 28
    static let contentWidth: CGFloat = 720
    static let sidebarWidth: CGFloat = 280
    // Touch-sized icon buttons (web: `pointer: coarse` → 40px).
    static let iconButton: CGFloat = 40
    // Rows nested under a disclosure start where the group label does.
    static let disclosureIndent: CGFloat = 48
}

// Web font sizes in px, scaled with Dynamic Type from the same baseline.
private struct FiloFontModifier: ViewModifier {
    let weight: Font.Weight
    @ScaledMetric private var size: CGFloat

    init(size: CGFloat, weight: Font.Weight) {
        self.weight = weight
        _size = ScaledMetric(wrappedValue: size, relativeTo: .body)
    }

    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight))
    }
}

extension View {
    func filoFont(_ size: CGFloat, _ weight: Font.Weight = .regular) -> some View {
        modifier(FiloFontModifier(size: size, weight: weight))
    }
}

struct FiloDivider: View {
    var color: Color = FiloPalette.mutedBorder

    var body: some View {
        Rectangle()
            .fill(color)
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

// MARK: - Buttons

// .fl-icon-btn: a muted glyph in a touch-sized box that tints on press.
struct FiloIconButton: View {
    let icon: FiloIconName
    let label: String
    var size: CGFloat = 18
    var color: Color?
    var filled = false
    var danger = false
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    init(
        _ icon: FiloIconName,
        label: String,
        size: CGFloat = 18,
        color: Color? = nil,
        filled: Bool = false,
        danger: Bool = false,
        action: @escaping () -> Void,
    ) {
        self.icon = icon
        self.label = label
        self.size = size
        self.color = color
        self.filled = filled
        self.danger = danger
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            FiloIcon(icon, size: size, filled: filled)
        }
        .buttonStyle(FiloIconButtonStyle(color: color, danger: danger))
        .accessibilityLabel(Text(localized: label))
    }
}

struct FiloIconButtonStyle: ButtonStyle {
    var color: Color?
    var danger = false

    func makeBody(configuration: Configuration) -> some View {
        FiloIconButtonBody(configuration: configuration, color: color, danger: danger)
    }
}

private struct FiloIconButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let color: Color?
    let danger: Bool
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .foregroundStyle(foreground)
            .frame(width: FiloMetrics.iconButton, height: FiloMetrics.iconButton)
            .background(
                RoundedRectangle(cornerRadius: FiloMetrics.radius)
                    .fill(configuration.isPressed ? (danger ? FiloPalette.dangerBackground : FiloPalette.pressed) : .clear)
            )
            .contentShape(Rectangle())
            .opacity(isEnabled ? 1 : 0.4)
    }

    private var foreground: Color {
        if configuration.isPressed { return danger ? FiloPalette.danger : (color ?? FiloPalette.text) }
        return color ?? FiloPalette.muted
    }
}

// The same box for Menu labels, which cannot take a ButtonStyle.
struct FiloIconLabel: View {
    let icon: FiloIconName
    var size: CGFloat = 18
    var color: Color = FiloPalette.muted

    init(_ icon: FiloIconName, size: CGFloat = 18, color: Color = FiloPalette.muted) {
        self.icon = icon
        self.size = size
        self.color = color
    }

    var body: some View {
        FiloIcon(icon, size: size, color: color)
            .frame(width: FiloMetrics.iconButton, height: FiloMetrics.iconButton)
            .contentShape(Rectangle())
    }
}

enum FiloButtonKind {
    case primary, secondary, ghost, danger
}

// .fl-btn
struct FiloButton: View {
    let title: String
    var icon: FiloIconName?
    var kind: FiloButtonKind = .secondary
    var small = false
    var fullWidth = false
    let action: () -> Void

    init(
        _ title: String,
        icon: FiloIconName? = nil,
        kind: FiloButtonKind = .secondary,
        small: Bool = false,
        fullWidth: Bool = false,
        action: @escaping () -> Void,
    ) {
        self.title = title
        self.icon = icon
        self.kind = kind
        self.small = small
        self.fullWidth = fullWidth
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            FiloButtonLabel(title: title, icon: icon, small: small)
                .frame(maxWidth: fullWidth ? .infinity : nil)
        }
        .buttonStyle(FiloButtonStyle(kind: kind, small: small))
    }
}

struct FiloButtonLabel: View {
    let title: String
    var icon: FiloIconName?
    var small = false

    var body: some View {
        HStack(spacing: small ? 4 : 6) {
            if let icon { FiloIcon(icon, size: small ? 14 : 16) }
            Text(localized: title)
                .lineLimit(1)
        }
    }
}

struct FiloButtonStyle: ButtonStyle {
    var kind: FiloButtonKind = .secondary
    var small = false

    func makeBody(configuration: Configuration) -> some View {
        FiloButtonBody(configuration: configuration, kind: kind, small: small)
    }
}

private struct FiloButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let kind: FiloButtonKind
    let small: Bool
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let radius = small ? FiloMetrics.radiusSmall : FiloMetrics.radius
        configuration.label
            .filoFont(small ? 13 : 14, .medium)
            .foregroundStyle(foreground)
            .padding(.horizontal, small ? 10 : 14)
            .frame(minHeight: small ? FiloMetrics.controlHeightSmall : FiloMetrics.controlHeight)
            .background(RoundedRectangle(cornerRadius: radius).fill(background))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(borderColor, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: radius))
            .opacity(isEnabled || kind == .primary ? 1 : 0.45)
    }

    private var foreground: Color {
        switch kind {
        case .primary: return isEnabled ? FiloPalette.onPrimary : FiloPalette.muted
        case .secondary: return FiloPalette.text
        case .ghost: return configuration.isPressed ? FiloPalette.text : FiloPalette.muted
        case .danger: return FiloPalette.danger
        }
    }

    private var background: Color {
        switch kind {
        case .primary:
            guard isEnabled else { return FiloPalette.pressed }
            return configuration.isPressed ? FiloPalette.primary.opacity(0.85) : FiloPalette.primary
        case .secondary:
            return configuration.isPressed ? FiloPalette.pressed : FiloPalette.surface
        case .ghost:
            return configuration.isPressed ? FiloPalette.pressed : .clear
        case .danger:
            return configuration.isPressed ? FiloPalette.dangerBackground : .clear
        }
    }

    private var borderColor: Color {
        switch kind {
        case .secondary: return FiloPalette.border
        case .danger: return FiloPalette.danger.opacity(0.45)
        case .primary, .ghost: return .clear
        }
    }
}

// .fl-chip
struct FiloChip: View {
    let label: String
    let isOn: Bool
    var localize = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            (localize ? Text(localized: label) : Text(verbatim: label))
                .filoFont(13, isOn ? .semibold : .regular)
                .lineLimit(1)
                .foregroundStyle(isOn ? FiloPalette.accent : FiloPalette.text)
                .padding(.horizontal, 12)
                .frame(height: FiloMetrics.controlHeightSmall)
                .background(Capsule().fill(isOn ? FiloPalette.accentSoft : .clear))
                .overlay(Capsule().strokeBorder(isOn ? FiloPalette.accent.opacity(0.45) : FiloPalette.border, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

// MARK: - Status

enum FiloTone {
    case muted, warn, danger, ok

    var foreground: Color {
        switch self {
        case .muted: return FiloPalette.muted
        case .warn: return FiloPalette.warn
        case .danger: return FiloPalette.danger
        case .ok: return FiloPalette.ok
        }
    }

    var background: Color {
        switch self {
        case .muted: return FiloPalette.pressed
        case .warn: return FiloPalette.warnBackground
        case .danger: return FiloPalette.dangerBackground
        case .ok: return FiloPalette.okBackground
        }
    }
}

// .fl-badge
struct FiloBadge: View {
    let label: String
    var tone: FiloTone = .muted

    var body: some View {
        Text(localized: label)
            .filoFont(12, .medium)
            .lineLimit(1)
            .foregroundStyle(tone.foreground)
            .padding(.horizontal, 7)
            .frame(height: 20)
            .background(RoundedRectangle(cornerRadius: FiloMetrics.radiusSmall).fill(tone.background))
    }
}

// .fl-status: quieter than a badge, for states inside a metadata line.
struct FiloStatusText: View {
    let label: String
    var tone: FiloTone = .muted

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(tone.foreground).frame(width: 6, height: 6)
            Text(localized: label)
                .filoFont(12)
                .lineLimit(1)
        }
        .foregroundStyle(tone.foreground)
    }
}

// Feed health as a quiet inline status; renders nothing for healthy feeds.
struct SubscriptionHealthView: View {
    let subscription: Subscription

    var body: some View {
        if subscription.initialFetchStatus == "failed" {
            FiloStatusText(label: ErrorMessages.initialFetchMessage(for: subscription.initialFetchErrorCode), tone: .danger)
        } else if subscription.initialFetchStatus == "fetching" {
            FiloStatusText(label: "記事取得中")
        } else if subscription.feedHealthStatus == "paused" {
            FiloStatusText(label: "更新停止中", tone: .danger)
        } else if subscription.feedHealthStatus == "stale" {
            FiloStatusText(label: "しばらく更新なし", tone: .warn)
        }
    }
}

// MARK: - Feedback

struct FiloSpinner: View {
    var label = "読み込み中…"

    var body: some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
                .tint(FiloPalette.accent)
            Text(localized: label)
                .filoFont(13)
                .foregroundStyle(FiloPalette.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
    }
}

struct FiloErrorBox: View {
    let message: String
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(spacing: 12) {
            Text(message)
                .filoFont(14)
                .lineSpacing(3)
                .foregroundStyle(FiloPalette.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let onRetry {
                FiloButton("再試行", small: true, action: onRetry)
            }
        }
        .padding(.vertical, 10)
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .background(RoundedRectangle(cornerRadius: FiloMetrics.radius).fill(FiloPalette.dangerBackground))
        .accessibilityElement(children: .contain)
    }
}

struct FiloEmptyState<Actions: View>: View {
    var icon: FiloIconName?
    let message: String
    @ViewBuilder var actions: Actions

    init(icon: FiloIconName? = nil, message: String, @ViewBuilder actions: () -> Actions = { EmptyView() }) {
        self.icon = icon
        self.message = message
        self.actions = actions()
    }

    var body: some View {
        VStack(spacing: 12) {
            if let icon {
                FiloIcon(icon, size: 22)
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(FiloPalette.hover))
            }
            Text(localized: message)
                .filoFont(14)
                .lineSpacing(4)
                .multilineTextAlignment(.center)
            actions
        }
        .foregroundStyle(FiloPalette.muted)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56)
        .padding(.horizontal, 24)
    }
}

struct FiloToast: View {
    let message: String

    var body: some View {
        Text(message)
            .filoFont(13)
            .lineSpacing(3)
            .foregroundStyle(FiloPalette.background)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: FiloMetrics.radius).fill(FiloPalette.text))
            .shadow(color: FiloPalette.shadow, radius: 12, y: 8)
            .frame(maxWidth: 480)
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .allowsHitTesting(false)
            .transition(.opacity.combined(with: .move(edge: .bottom)))
            .accessibilityAddTraits(.updatesFrequently)
    }
}

struct BlockingProgressOverlay: View {
    let message: String

    var body: some View {
        ZStack {
            FiloPalette.scrim
                .ignoresSafeArea()
            HStack(spacing: 12) {
                ProgressView()
                    .controlSize(.small)
                    .tint(FiloPalette.accent)
                Text(message)
                    .filoFont(14)
                    .foregroundStyle(FiloPalette.text)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(RoundedRectangle(cornerRadius: FiloMetrics.radiusLarge).fill(FiloPalette.surface))
            .overlay(RoundedRectangle(cornerRadius: FiloMetrics.radiusLarge).strokeBorder(FiloPalette.mutedBorder, lineWidth: 1))
            .shadow(color: FiloPalette.shadow, radius: 32, y: 24)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message)
        .accessibilityAddTraits(.isModal)
        .contentShape(Rectangle())
        .onTapGesture {}
    }
}

// MARK: - Surfaces

// .fl-section-title
struct FiloSectionTitle: View {
    let title: String
    var danger = false

    var body: some View {
        Text(localized: title)
            .filoFont(13, .semibold)
            .foregroundStyle(danger ? FiloPalette.danger : FiloPalette.muted)
            .padding(.leading, 4)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

// .fl-card with .fl-card-row children separated by hairlines.
struct FiloCard<Content: View>: View {
    var danger = false
    @ViewBuilder var content: Content

    var body: some View {
        Group(subviews: content) { rows in
            VStack(spacing: 0) {
                ForEach(rows.indices, id: \.self) { index in
                    if index > 0 { FiloDivider() }
                    rows[index]
                }
            }
        }
            .background(RoundedRectangle(cornerRadius: FiloMetrics.radiusLarge).fill(FiloPalette.surface))
            .overlay(
                RoundedRectangle(cornerRadius: FiloMetrics.radiusLarge)
                    .strokeBorder(danger ? FiloPalette.danger.opacity(0.35) : FiloPalette.mutedBorder, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: FiloMetrics.radiusLarge))
    }
}

// .fl-card-row: label (+hint) beside or above its control.
struct FiloCardRow<Control: View>: View {
    let label: String?
    var hint: String?
    var stacked = false
    @ViewBuilder var control: Control

    init(_ label: String? = nil, hint: String? = nil, stacked: Bool = false, @ViewBuilder control: () -> Control) {
        self.label = label
        self.hint = hint
        self.stacked = stacked
        self.control = control()
    }

    var body: some View {
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
            : AnyLayout(HStackLayout(spacing: 16))
        layout {
            if label != nil || hint != nil {
                VStack(alignment: .leading, spacing: 2) {
                    if let label {
                        Text(localized: label).filoFont(14)
                    }
                    if let hint {
                        Text(localized: hint)
                            .filoFont(12)
                            .lineSpacing(3)
                            .foregroundStyle(FiloPalette.muted)
                    }
                }
                .frame(maxWidth: stacked ? .infinity : nil, alignment: .leading)
                if !stacked { Spacer(minLength: 0) }
            }
            control
        }
        .foregroundStyle(FiloPalette.text)
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

// MARK: - Form controls

// .fl-field
struct FiloField<Content: View>: View {
    let label: String
    var hint: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(localized: label)
                .filoFont(13, .semibold)
                .foregroundStyle(FiloPalette.text)
            content
            if let hint {
                Text(localized: hint)
                    .filoFont(12)
                    .lineSpacing(3)
                    .foregroundStyle(FiloPalette.muted)
            }
        }
    }
}

// .fl-input
struct FiloTextField: View {
    let placeholder: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default
    var isURL = false
    var onSubmit: () -> Void = {}
    @FocusState private var isFocused: Bool

    var body: some View {
        TextField("", text: $text, prompt: Text(localized: placeholder).foregroundStyle(FiloPalette.muted))
            .filoFont(14)
            .foregroundStyle(FiloPalette.text)
            .keyboardType(isURL ? .URL : keyboard)
            .textInputAutocapitalization(isURL ? .never : nil)
            .autocorrectionDisabled(isURL)
            .submitLabel(.done)
            .onSubmit(onSubmit)
            .focused($isFocused)
            .padding(.horizontal, 12)
            .frame(height: FiloMetrics.controlHeight)
            .background(RoundedRectangle(cornerRadius: FiloMetrics.radius).fill(FiloPalette.surface))
            .overlay(
                RoundedRectangle(cornerRadius: FiloMetrics.radius)
                    .strokeBorder(isFocused ? FiloPalette.accent : FiloPalette.border, lineWidth: 1)
            )
            .background(
                RoundedRectangle(cornerRadius: FiloMetrics.radius + 3)
                    .stroke(isFocused ? FiloPalette.accentSoft : .clear, lineWidth: 3)
                    .padding(-1.5)
            )
            .animation(.easeOut(duration: 0.12), value: isFocused)
    }
}

// .fl-select: a bordered value with a trailing chevron that opens a menu.
struct FiloSelect<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, label: String)]
    var label: String
    var minWidth: CGFloat? = nil

    var body: some View {
        Menu {
            Picker(L10n.string(label), selection: $selection) {
                ForEach(options, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
        } label: {
            HStack(spacing: 8) {
                Text(options.first(where: { $0.value == selection })?.label ?? "")
                    .filoFont(14)
                    .foregroundStyle(FiloPalette.text)
                    .lineLimit(1)
                Spacer(minLength: 0)
                FiloIcon(.chevronDown, size: 16, color: FiloPalette.muted)
            }
            .padding(.leading, 12)
            .padding(.trailing, 10)
            .frame(minWidth: minWidth, maxWidth: minWidth == nil ? .infinity : nil)
            .frame(height: FiloMetrics.controlHeight)
            .background(RoundedRectangle(cornerRadius: FiloMetrics.radius).fill(FiloPalette.surface))
            .overlay(RoundedRectangle(cornerRadius: FiloMetrics.radius).strokeBorder(FiloPalette.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .tint(FiloPalette.text)
        .accessibilityLabel(Text(localized: label))
    }
}

struct FiloToggle: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(L10n.string(label), isOn: $isOn)
            .labelsHidden()
            .tint(FiloPalette.primary)
    }
}

// Wraps chips onto new lines like `flex-wrap: wrap`.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat? = nil

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .greatestFiniteMagnitude, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(width: bounds.width, subviews: subviews)
        for row in rows {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), anchor: .topLeading, proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }

    private struct Row {
        var indices: [Int] = []
        var y: CGFloat = 0
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width maxWidth: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let nextWidth = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if !row.indices.isEmpty && nextWidth > maxWidth {
                rows.append(row)
                row = Row(y: row.y + row.height + (lineSpacing ?? spacing))
            }
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

// MARK: - Brand

// apps/web/public/logo.svg, drawn natively.
struct FiloLogo: View {
    var size: CGFloat = 26

    var body: some View {
        Canvas { context, canvasSize in
            let scale = canvasSize.width / 512
            var path = Path()
            path.move(to: CGPoint(x: 112, y: 260))
            path.addCurve(to: CGPoint(x: 132, y: 236), control1: CGPoint(x: 112, y: 248), control2: CGPoint(x: 120, y: 240))
            path.addLine(to: CGPoint(x: 390, y: 146))
            path.addCurve(to: CGPoint(x: 410, y: 166), control1: CGPoint(x: 404, y: 141), control2: CGPoint(x: 416, y: 153))
            path.addLine(to: CGPoint(x: 298, y: 402))
            path.addCurve(to: CGPoint(x: 269, y: 405), control1: CGPoint(x: 292, y: 415), control2: CGPoint(x: 277, y: 416))
            path.addLine(to: CGPoint(x: 226, y: 340))
            path.addCurve(to: CGPoint(x: 207, y: 323), control1: CGPoint(x: 221, y: 333), control2: CGPoint(x: 215, y: 327))
            path.addLine(to: CGPoint(x: 126, y: 277))
            path.addCurve(to: CGPoint(x: 112, y: 260), control1: CGPoint(x: 116, y: 271), control2: CGPoint(x: 112, y: 267))
            path.closeSubpath()
            let gradient = Gradient(stops: [
                .init(color: Color(hex: 0x4FC3FF), location: 0),
                .init(color: Color(hex: 0x7C5CFF), location: 0.5),
                .init(color: Color(hex: 0xFF4DB8), location: 1),
            ])
            context.fill(
                path.applying(CGAffineTransform(scaleX: scale, y: scale)),
                with: .linearGradient(
                    gradient,
                    startPoint: CGPoint(x: 112 * scale, y: 360 * scale),
                    endPoint: CGPoint(x: 408 * scale, y: 152 * scale),
                ),
            )
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct FiloBrand: View {
    var size: CGFloat = 26

    var body: some View {
        HStack(spacing: 8) {
            FiloLogo(size: size)
            Text(verbatim: "Filo")
                .filoFont(17, .bold)
                .foregroundStyle(FiloPalette.text)
        }
    }
}
