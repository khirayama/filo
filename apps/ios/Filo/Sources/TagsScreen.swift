import SwiftUI

// MARK: - Tags management

struct TagsScreen: View {
    @State private var tags: [Tag] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var newName = ""
    @State private var editingTagId: Int?
    @State private var editName = ""
    @State private var editColor = ""
    @State private var pendingDelete: [Tag] = []
    @State private var showDeleteConfirm = false
    @State private var isReordering = false

    var body: some View {
        List {
            Section {
                HStack {
                    TextField("新しいタグ名", text: $newName)
                    Button("追加") { Task { await create() } }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            if let errorMessage {
                ErrorBanner(message: errorMessage) { Task { await load() } }
            }
            if isLoading {
                ProgressView("読み込み中…")
            } else if tags.isEmpty {
                EmptyStateView { Text("タグがありません。上の入力欄から作成できます。") }
            } else {
                Section {
                    ForEach(tags) { tag in
                        if editingTagId == tag.id {
                            VStack(spacing: 8) {
                                HStack(spacing: 8) {
                                    TextField("タグ名", text: $editName)
                                        .textFieldStyle(.roundedBorder)
                                    ColorPicker("色", selection: Binding(
                                        get: {
                                            if let hex = parseHexColor(editColor) { return hex }
                                            return .blue
                                        },
                                        set: { newColor in
                                            editColor = newColor.toHex()
                                        }
                                    ), supportsOpacity: false)
                                    .labelsHidden()
                                    if !editColor.isEmpty {
                                        Button("色を解除") { editColor = "" }
                                            .font(.caption)
                                    }
                                }
                                HStack(spacing: 8) {
                                    Button("保存") {
                                        Task { await saveEdit(tag) }
                                    }
                                    .disabled(editName.trimmingCharacters(in: .whitespaces).isEmpty)
                                    Button("キャンセル") {
                                        editingTagId = nil
                                    }
                                }
                                .font(.callout)
                            }
                        } else {
                            HStack {
                                if let color = tag.color, let parsed = parseHexColor(color) {
                                    Circle()
                                        .fill(parsed)
                                        .frame(width: 12, height: 12)
                                }
                                VStack(alignment: .leading) {
                                    Text(tag.name)
                                    Text("\(tag.subscriptionCount)件の購読")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("編集") {
                                    editingTagId = tag.id
                                    editName = tag.name
                                    editColor = tag.color ?? ""
                                }
                                .font(.callout)
                            }
                        }
                    }
                    .onMove { source, destination in
                        reorderTags(from: source, to: destination)
                    }
                    .onDelete { offsets in
                        pendingDelete = offsets.map { tags[$0] }
                        showDeleteConfirm = true
                    }
                    .moveDisabled(isReordering)
                }
            }
        }
        .navigationTitle("タグ管理")
        .toolbar { EditButton() }
        .task { await load() }
        .confirmationDialog(
            deleteConfirmTitle,
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("削除する", role: .destructive) {
                let removed = pendingDelete
                pendingDelete = []
                Task { await deleteTags(removed) }
            }
            Button("キャンセル", role: .cancel) { pendingDelete = [] }
        }
    }

    private var deleteConfirmTitle: String {
        let names = pendingDelete.map { "「\($0.name)」" }.joined()
        return "タグ\(names)を削除しますか？購読は削除されません。"
    }

    private func deleteTags(_ removed: [Tag]) async {
        do {
            for tag in removed {
                try await APIClient.shared.deleteTag(tag.id)
            }
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        await load()
    }

    private func reorderTags(from source: IndexSet, to destination: Int) {
        guard !isReordering else { return }
        let original = tags
        tags.move(fromOffsets: source, toOffset: destination)
        let reorderedIds = tags.map(\.id)
        isReordering = true
        Task {
            do {
                try await APIClient.shared.reorderTags(reorderedIds)
                errorMessage = nil
            } catch {
                tags = original
                errorMessage = ErrorMessages.message(for: error)
            }
            isReordering = false
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            tags = try await APIClient.shared.listTags()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoading = false
    }

    private func create() async {
        do {
            _ = try await APIClient.shared.createTag(name: newName.trimmingCharacters(in: .whitespaces))
            newName = ""
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }

    private func saveEdit(_ tag: Tag) async {
        let trimmed = editName.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        let newColor = editColor.isEmpty ? nil : editColor
        let clearColor = editColor.isEmpty && tag.color != nil
        do {
            _ = try await APIClient.shared.updateTag(tag.id, name: trimmed, color: newColor, clearColor: clearColor)
            editingTagId = nil
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }
}

private func parseHexColor(_ hex: String) -> Color? {
    var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if h.hasPrefix("#") { h.removeFirst() }
    guard h.count == 6, let val = UInt64(h, radix: 16) else { return nil }
    return Color(
        red: Double((val >> 16) & 0xFF) / 255,
        green: Double((val >> 8) & 0xFF) / 255,
        blue: Double(val & 0xFF) / 255
    )
}

extension Color {
    func toHex() -> String {
        guard let components = UIColor(self).cgColor.components, components.count >= 3 else { return "" }
        let r = Int(components[0] * 255)
        let g = Int(components[1] * 255)
        let b = Int(components[2] * 255)
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}
