import SwiftUI
import SwiftData

enum MoneyMove: String, Identifiable {
    case deposit, withdrawal
    var id: String { rawValue }

    var title: String {
        switch self {
        case .deposit: "Add Money"
        case .withdrawal: "Withdraw"
        }
    }
}

struct JarDetailView: View {
    @Bindable var jar: Jar
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var move: MoneyMove?
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var coinTrigger = 0
    @State private var celebrateTrigger = 0

    private let quickAmounts: [Double] = [5, 10, 20, 50]

    var body: some View {
        List {
            Section {
                header
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
            }

            Section("History") {
                if jar.deposits.isEmpty {
                    Text("Nothing in here yet. Tap a button above to drop in your first coin.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(jar.history) { deposit in
                        DepositRow(deposit: deposit, color: jar.color.color)
                    }
                    .onDelete(perform: deleteDeposits)
                }
            }
        }
        .overlay { ConfettiView(trigger: celebrateTrigger).ignoresSafeArea() }
        .navigationTitle(jar.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { editing = true } label: {
                        Label("Edit Jar", systemImage: "pencil")
                    }
                    Button(role: .destructive) { confirmingDelete = true } label: {
                        Label("Delete Jar", systemImage: "trash")
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
            }
        }
        .sheet(item: $move) { move in
            MoneySheet(
                move: move,
                available: jar.saved,
                tint: jar.color.color
            ) { amount, note, date in
                record(move == .deposit ? amount : -amount, note: note, date: date)
            }
        }
        .sheet(isPresented: $editing) {
            JarEditorView(jar: jar)
        }
        .confirmationDialog("Delete “\(jar.name)”?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete Jar", role: .destructive, action: deleteJar)
        } message: {
            Text("The jar and its whole history will be removed.")
        }
        .sensoryFeedback(.increase, trigger: coinTrigger)
        .sensoryFeedback(.success, trigger: celebrateTrigger)
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 14) {
            ZStack {
                JarView(progress: jar.progress, color: jar.color)
                Text(jar.emoji)
                    .font(.system(size: 54))
                    .offset(y: 14)
                CoinDrop(trigger: coinTrigger, distance: 130)
            }
            .frame(height: 250)

            VStack(spacing: 4) {
                Text(Money.format(jar.saved))
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .contentTransition(.numericText(value: jar.saved))
                    .monospacedDigit()
                Text("of \(Money.format(jar.goal)) · \(Int((jar.progress * 100).rounded()))%")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
                if let pace = jar.paceDescription {
                    Text(pace)
                        .font(.footnote)
                        .foregroundStyle(jar.isComplete ? jar.color.color : Color.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 2)
                }
            }

            HStack(spacing: 8) {
                ForEach(quickAmounts, id: \.self) { amount in
                    Button {
                        record(amount)
                    } label: {
                        Text("+\(Money.short(amount))")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Add \(Money.short(amount))")
                }
            }
            .tint(jar.color.color)

            HStack(spacing: 10) {
                Button {
                    move = .deposit
                } label: {
                    Label("Add Money", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    move = .withdrawal
                } label: {
                    Label("Withdraw", systemImage: "minus.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(jar.saved <= 0)
            }
            .controlSize(.large)
            .tint(jar.color.color)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 4)
    }

    // MARK: - Actions

    private func record(_ amount: Double, note: String = "", date: Date = .now) {
        let wasComplete = jar.isComplete
        let deposit = Deposit(amount: amount, note: note.trimmingCharacters(in: .whitespacesAndNewlines), date: date)
        context.insert(deposit)
        withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
            jar.deposits.append(deposit)
        }
        if amount > 0 { coinTrigger += 1 }
        if !wasComplete && jar.isComplete { celebrateTrigger += 1 }
    }

    private func deleteDeposits(at offsets: IndexSet) {
        let items = jar.history
        withAnimation {
            for index in offsets {
                let deposit = items[index]
                jar.deposits.removeAll { $0.persistentModelID == deposit.persistentModelID }
                context.delete(deposit)
            }
        }
    }

    private func deleteJar() {
        let doomed = jar
        dismiss()
        // Delete after the pop animation so this screen never renders a deleted model.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            context.delete(doomed)
        }
    }
}

struct DepositRow: View {
    let deposit: Deposit
    let color: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: deposit.isWithdrawal ? "arrow.up.circle.fill" : "arrow.down.circle.fill")
                .font(.title2)
                .foregroundStyle(deposit.isWithdrawal ? Color.orange : color)

            VStack(alignment: .leading, spacing: 2) {
                Text(deposit.note.isEmpty ? (deposit.isWithdrawal ? "Withdrawal" : "Deposit") : deposit.note)
                    .lineLimit(1)
                Text(deposit.date, format: .dateTime.month(.abbreviated).day().year())
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text((deposit.isWithdrawal ? "−" : "+") + Money.format(abs(deposit.amount)))
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(deposit.isWithdrawal ? Color.orange : Color.primary)
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    NavigationStack {
        JarDetailView(jar: PreviewData.sampleJar)
    }
    .modelContainer(PreviewData.container)
}
