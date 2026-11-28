import Foundation
import SwiftData

/// Sample jars for Xcode previews only.
@MainActor
enum PreviewData {
    static let container: ModelContainer = {
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        // swiftlint:disable:next force_try
        let container = try! ModelContainer(for: Jar.self, Deposit.self, configurations: config)
        let context = container.mainContext

        let japan = Jar(
            name: "Trip to Japan",
            emoji: "✈️",
            goal: 2500,
            color: .berry,
            deadline: Calendar.current.date(byAdding: .month, value: 5, to: .now)
        )
        let laptop = Jar(name: "New laptop", emoji: "💻", goal: 1200, color: .ocean)
        let bike = Jar(name: "Bike", emoji: "🚲", goal: 400, color: .mint)
        for jar in [japan, laptop, bike] { context.insert(jar) }

        let entries: [(Jar, Double, String, Int)] = [
            (japan, 500, "Bonus", -40),
            (japan, 250, "", -21),
            (japan, -60, "Rail pass deposit", -10),
            (japan, 100, "Birthday money", -2),
            (laptop, 300, "", -14),
            (bike, 400, "Sold old bike", -5),
        ]
        for (jar, amount, note, daysAgo) in entries {
            let deposit = Deposit(
                amount: amount,
                note: note,
                date: Calendar.current.date(byAdding: .day, value: daysAgo, to: .now) ?? .now
            )
            context.insert(deposit)
            jar.deposits.append(deposit)
        }
        return container
    }()

    static var sampleJar: Jar {
        let descriptor = FetchDescriptor<Jar>(sortBy: [SortDescriptor(\.createdAt)])
        return (try? container.mainContext.fetch(descriptor).first) ?? Jar(name: "Sample", emoji: "💰", goal: 100)
    }
}
