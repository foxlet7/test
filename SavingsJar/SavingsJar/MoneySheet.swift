import SwiftUI

/// Sheet for adding money to, or withdrawing money from, a jar.
struct MoneySheet: View {
    let move: MoneyMove
    let available: Double
    let tint: Color
    var onSave: (_ amount: Double, _ note: String, _ date: Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var amountText = ""
    @State private var note = ""
    @State private var date = Date.now
    @FocusState private var amountFocused: Bool

    private var amount: Double? { Money.parse(amountText) }

    private var isValid: Bool {
        guard let amount else { return false }
        return move == .deposit || amount <= available + 0.001
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 6) {
                        Text(Money.symbol)
                            .foregroundStyle(.secondary)
                        TextField("0", text: $amountText)
                            .keyboardType(.decimalPad)
                            .focused($amountFocused)
                    }
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                } footer: {
                    if move == .withdrawal {
                        if let amount, amount > available + 0.001 {
                            Text("There's only \(Money.format(available)) in this jar.")
                                .foregroundStyle(.red)
                        } else {
                            Text("\(Money.format(available)) available")
                        }
                    }
                }

                Section {
                    TextField(move == .deposit ? "Note (e.g. Birthday money)" : "Note (e.g. Concert tickets)", text: $note)
                    DatePicker("Date", selection: $date, in: ...Date.now, displayedComponents: .date)
                }
            }
            .navigationTitle(move.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(move == .deposit ? "Add" : "Withdraw") {
                        guard let amount, isValid else { return }
                        onSave(amount, note, date)
                        dismiss()
                    }
                    .bold()
                    .disabled(!isValid)
                }
            }
            .onAppear { amountFocused = true }
        }
        .tint(tint)
        .presentationDetents([.medium, .large])
    }
}

#Preview {
    MoneySheet(move: .withdrawal, available: 120, tint: .blue) { _, _, _ in }
}
