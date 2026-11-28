import Foundation
import SwiftData

/// A savings goal: "Trip to Japan", "New laptop", ...
@Model
final class Jar {
    var name: String
    var emoji: String
    var goal: Double
    var colorName: String
    var createdAt: Date
    var deadline: Date?

    @Relationship(deleteRule: .cascade, inverse: \Deposit.jar)
    var deposits: [Deposit] = []

    init(name: String, emoji: String, goal: Double, color: JarColor = .ocean, deadline: Date? = nil) {
        self.name = name
        self.emoji = emoji
        self.goal = goal
        self.colorName = color.rawValue
        self.createdAt = .now
        self.deadline = deadline
    }

    /// Money currently in the jar (deposits minus withdrawals).
    var saved: Double { deposits.reduce(0) { $0 + $1.amount } }

    /// 0...1 fill level.
    var progress: Double {
        guard goal > 0 else { return 0 }
        return min(max(saved / goal, 0), 1)
    }

    var remaining: Double { max(goal - saved, 0) }
    var isComplete: Bool { goal > 0 && saved >= goal }

    var color: JarColor {
        get { JarColor(rawValue: colorName) ?? .ocean }
        set { colorName = newValue.rawValue }
    }

    /// Newest first.
    var history: [Deposit] { deposits.sorted { $0.date > $1.date } }

    /// "Save $25 a week to reach it by Mar 3", or nil when there's no target date.
    var paceDescription: String? {
        if isComplete { return "Goal reached! 🎉" }
        guard let deadline else { return nil }
        let calendar = Calendar.current
        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: .now),
            to: calendar.startOfDay(for: deadline)
        ).day ?? 0
        if days <= 0 {
            return "Target date passed · \(Money.format(remaining)) to go"
        }
        let weeks = max(Double(days) / 7, 1)
        let dateText = deadline.formatted(date: .abbreviated, time: .omitted)
        return "Save \(Money.format(remaining / weeks)) a week to reach it by \(dateText)"
    }
}

/// Money going into (positive) or out of (negative) a jar.
@Model
final class Deposit {
    var amount: Double
    var note: String
    var date: Date
    var jar: Jar?

    init(amount: Double, note: String = "", date: Date = .now) {
        self.amount = amount
        self.note = note
        self.date = date
    }

    var isWithdrawal: Bool { amount < 0 }
}
