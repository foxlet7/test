# Savings Jar 🫙

A small SwiftUI app for iPhone: make a jar for each thing you're saving up for
and watch it fill as you drop money in.

## Features

- **Jars:** name, emoji, goal amount, color and an optional target date
- **Animated glass jar:** the liquid sloshes and rises as the jar fills
- **Quick add:** +5 / +10 / +20 / +50 buttons with a falling coin and a haptic tap
- **Add or withdraw** a custom amount with a note and date
- **Pace:** with a target date, the jar tells you how much to save each week
- **Confetti** and a success haptic when you reach a goal
- **History:** every deposit and withdrawal, swipe to delete
- Total saved across all jars on the home screen
- Uses your phone's currency and number format
- Everything is stored on the phone with SwiftData: no account, no server

## Run it

Requirements: a Mac with **Xcode 16 or newer**, and iOS 17+ on the phone or simulator.

1. Open `SavingsJar/SavingsJar.xcodeproj` in Xcode.
2. Pick an iPhone simulator at the top of the window and press **⌘R**.

To run it on your own iPhone:

1. Plug the phone in (or pair it over Wi-Fi) and select it as the run destination.
2. Select the **SavingsJar** target → **Signing & Capabilities** → choose your **Team**
   (a free Apple ID works). If Xcode says the bundle identifier is taken, change
   `com.example.SavingsJar` to something unique, such as `com.yourname.SavingsJar`.
3. Press **⌘R**. The first time, on the phone, go to Settings → General →
   VPN & Device Management and trust your developer certificate.
   (On iOS 16+ you may also need Settings → Privacy & Security → Developer Mode.)

## Code layout

| File | What it does |
| --- | --- |
| `SavingsJarApp.swift` | App entry point and SwiftData container |
| `Models.swift` | `Jar` and `Deposit` models, progress and pace calculations |
| `Theme.swift` | Jar colors and currency formatting and parsing |
| `JarView.swift` | Jar shape, animated liquid, coin drop, confetti |
| `JarListView.swift` | Home screen: total saved and the grid of jars |
| `JarDetailView.swift` | One jar: big animated jar, quick add, history |
| `MoneySheet.swift` | Add-money / withdraw sheet |
| `JarEditorView.swift` | Create or edit a jar |
| `PreviewData.swift` | Sample data for Xcode previews |
