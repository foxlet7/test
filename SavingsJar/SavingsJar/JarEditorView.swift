import SwiftUI
import SwiftData

/// Create a new jar (`jar == nil`) or edit an existing one.
struct JarEditorView: View {
    let jar: Jar?

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var emoji: String
    @State private var goalText: String
    @State private var color: JarColor
    @State private var hasDeadline: Bool
    @State private var deadline: Date

    static let emojis = [
        "✈️", "🏖️", "🏠", "🚗", "🚲", "💻", "📱", "🎮",
        "🎸", "📷", "🎓", "💍", "🎁", "🐶", "👶", "💰",
    ]

    init(jar: Jar?) {
        self.jar = jar
        let threeMonths = Calendar.current.date(byAdding: .month, value: 3, to: .now) ?? .now
        _name = State(initialValue: jar?.name ?? "")
        _emoji = State(initialValue: jar?.emoji ?? Self.emojis[0])
        _goalText = State(initialValue: jar.map { Money.plain($0.goal) } ?? "")
        _color = State(initialValue: jar?.color ?? .ocean)
        _hasDeadline = State(initialValue: jar?.deadline != nil)
        _deadline = State(initialValue: jar?.deadline ?? threeMonths)
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var goal: Double? { Money.parse(goalText) }
    private var isValid: Bool { !trimmedName.isEmpty && goal != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ZStack {
                        JarView(progress: 0.55, color: color)
                        Text(emoji)
                            .font(.system(size: 40))
                            .offset(y: 10)
                    }
                    .frame(height: 150)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .animation(.easeInOut, value: color)
                }

                Section("What are you saving for?") {
                    TextField("e.g. Trip to Japan", text: $name)
                        .textInputAutocapitalization(.words)
                }

                Section("Goal") {
                    HStack(spacing: 6) {
                        Text(Money.symbol)
                            .foregroundStyle(.secondary)
                        TextField("0", text: $goalText)
                            .keyboardType(.decimalPad)
                    }
                    .font(.title3.weight(.semibold))
                }

                Section("Icon") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 10) {
                        ForEach(Self.emojis, id: \.self) { option in
                            Button {
                                emoji = option
                            } label: {
                                Text(option)
                                    .font(.title2)
                                    .frame(width: 36, height: 36)
                                    .background(
                                        Circle().fill(option == emoji ? color.color.opacity(0.25) : Color.clear)
                                    )
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(option == emoji ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section("Color") {
                    HStack {
                        ForEach(JarColor.allCases) { option in
                            Button {
                                color = option
                            } label: {
                                Circle()
                                    .fill(option.color)
                                    .frame(width: 34, height: 34)
                                    .overlay(
                                        Circle()
                                            .strokeBorder(Color.primary.opacity(option == color ? 0.8 : 0), lineWidth: 3)
                                            .padding(-5)
                                    )
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(option.rawValue.capitalized)
                            .accessibilityAddTraits(option == color ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 6)
                }

                Section {
                    Toggle("Target date", isOn: $hasDeadline.animation())
                    if hasDeadline {
                        DatePicker("Reach goal by", selection: $deadline, in: Date.now..., displayedComponents: .date)
                    }
                } footer: {
                    Text("With a target date, the jar tells you how much to save each week.")
                }
            }
            .navigationTitle(jar == nil ? "New Jar" : "Edit Jar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(jar == nil ? "Create" : "Save", action: save)
                        .bold()
                        .disabled(!isValid)
                }
            }
        }
        .tint(color.color)
    }

    private func save() {
        guard let goal, !trimmedName.isEmpty else { return }
        let target = hasDeadline ? deadline : nil
        if let jar {
            jar.name = trimmedName
            jar.emoji = emoji
            jar.goal = goal
            jar.color = color
            jar.deadline = target
        } else {
            context.insert(Jar(name: trimmedName, emoji: emoji, goal: goal, color: color, deadline: target))
        }
        dismiss()
    }
}

#Preview {
    JarEditorView(jar: nil)
        .modelContainer(PreviewData.container)
}
