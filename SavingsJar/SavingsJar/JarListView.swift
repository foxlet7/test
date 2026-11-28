import SwiftUI
import SwiftData

struct JarListView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Jar.createdAt) private var jars: [Jar]
    @State private var showingNewJar = false
    @State private var jarPendingDelete: Jar?

    private var totalSaved: Double { jars.reduce(0) { $0 + $1.saved } }
    private var totalGoal: Double { jars.reduce(0) { $0 + $1.goal } }

    private let columns = [
        GridItem(.flexible(), spacing: 16),
        GridItem(.flexible(), spacing: 16),
    ]

    var body: some View {
        NavigationStack {
            Group {
                if jars.isEmpty {
                    emptyState
                } else {
                    ScrollView {
                        VStack(spacing: 20) {
                            summary
                            LazyVGrid(columns: columns, spacing: 16) {
                                ForEach(jars) { jar in
                                    NavigationLink(value: jar) {
                                        JarCard(jar: jar)
                                    }
                                    .buttonStyle(.plain)
                                    .contextMenu {
                                        Button(role: .destructive) {
                                            jarPendingDelete = jar
                                        } label: {
                                            Label("Delete Jar", systemImage: "trash")
                                        }
                                    }
                                }
                            }
                        }
                        .padding()
                    }
                    .background(Color(.systemGroupedBackground))
                }
            }
            .navigationTitle("Savings Jars")
            .navigationDestination(for: Jar.self) { jar in
                JarDetailView(jar: jar)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingNewJar = true
                    } label: {
                        Label("New Jar", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingNewJar) {
                JarEditorView(jar: nil)
            }
            .confirmationDialog(
                "Delete “\(jarPendingDelete?.name ?? "")”?",
                isPresented: Binding(
                    get: { jarPendingDelete != nil },
                    set: { if !$0 { jarPendingDelete = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete Jar", role: .destructive) {
                    if let jar = jarPendingDelete {
                        withAnimation { context.delete(jar) }
                    }
                    jarPendingDelete = nil
                }
            } message: {
                Text("The jar and its whole history will be removed.")
            }
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Total saved")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            Text(Money.format(totalSaved))
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .contentTransition(.numericText(value: totalSaved))
            ProgressView(value: totalGoal > 0 ? min(totalSaved / totalGoal, 1) : 0)
                .tint(.accentColor)
            Text("\(Money.short(totalGoal)) across \(jars.count) \(jars.count == 1 ? "jar" : "jars")")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                Text("No jars yet")
            } icon: {
                JarView(progress: 0.35, color: .ocean)
                    .frame(height: 90)
            }
        } description: {
            Text("Make a jar for something you're saving up for, then drop money in as you go.")
        } actions: {
            Button("Create a Jar") { showingNewJar = true }
                .buttonStyle(.borderedProminent)
        }
    }
}

struct JarCard: View {
    let jar: Jar

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack {
                JarView(progress: jar.progress, color: jar.color)
                Text(jar.emoji)
                    .font(.system(size: 32))
                    .offset(y: 8)
            }
            .frame(height: 120)
            .frame(maxWidth: .infinity)

            Text(jar.name)
                .font(.headline)
                .lineLimit(1)

            HStack(spacing: 4) {
                Text(Money.short(jar.saved))
                    .foregroundStyle(.primary)
                Text("of \(Money.short(jar.goal))")
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline)
            .lineLimit(1)
            .minimumScaleFactor(0.8)

            ProgressView(value: jar.progress)
                .tint(jar.color.color)
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
        .overlay(alignment: .topTrailing) {
            if jar.isComplete {
                Image(systemName: "checkmark.seal.fill")
                    .font(.title3)
                    .foregroundStyle(jar.color.color)
                    .padding(10)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

#Preview {
    JarListView()
        .modelContainer(PreviewData.container)
}
