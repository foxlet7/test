import SwiftUI
import SwiftData

@main
struct SavingsJarApp: App {
    var body: some Scene {
        WindowGroup {
            JarListView()
        }
        .modelContainer(for: [Jar.self, Deposit.self])
    }
}
