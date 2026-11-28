import SwiftUI

enum JarColor: String, CaseIterable, Identifiable {
    case ocean, mint, sunset, berry, lemon, grape

    var id: String { rawValue }

    var color: Color {
        switch self {
        case .ocean:  Color(red: 0.20, green: 0.55, blue: 0.95)
        case .mint:   Color(red: 0.18, green: 0.75, blue: 0.60)
        case .sunset: Color(red: 1.00, green: 0.55, blue: 0.25)
        case .berry:  Color(red: 0.92, green: 0.30, blue: 0.50)
        case .lemon:  Color(red: 0.96, green: 0.74, blue: 0.15)
        case .grape:  Color(red: 0.56, green: 0.40, blue: 0.92)
        }
    }

    var fill: LinearGradient {
        LinearGradient(colors: [color.opacity(0.80), color], startPoint: .top, endPoint: .bottom)
    }
}

enum Money {
    static var code: String { Locale.current.currency?.identifier ?? "USD" }
    static var symbol: String { Locale.current.currencySymbol ?? "$" }

    /// "$1,234.50"
    static func format(_ value: Double) -> String {
        value.formatted(.currency(code: code))
    }

    /// "$1,235" — for tight spaces.
    static func short(_ value: Double) -> String {
        value.formatted(.currency(code: code).precision(.fractionLength(0)))
    }

    /// "1234.5" in the user's locale, for pre-filling text fields.
    static func plain(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }

    /// Parses what someone typed on the decimal pad ("12.50", "12,50", "1,200").
    /// Returns nil for empty, invalid or non-positive input.
    static func parse(_ text: String) -> Double? {
        let decimalSeparator = Locale.current.decimalSeparator ?? "."
        var cleaned = String(text.filter { ($0.isASCII && $0.isNumber) || $0 == "." || $0 == "," })
        if decimalSeparator == "," {
            cleaned = cleaned
                .replacingOccurrences(of: ".", with: "")
                .replacingOccurrences(of: ",", with: ".")
        } else {
            cleaned = cleaned.replacingOccurrences(of: ",", with: "")
        }
        guard let value = Double(cleaned), value > 0, value.isFinite else { return nil }
        return (value * 100).rounded() / 100
    }
}
