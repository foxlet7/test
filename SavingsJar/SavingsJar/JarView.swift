import SwiftUI

/// The glass jar outline: a short neck, rounded shoulders, a rounded base.
struct JarShape: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width
        let h = rect.height
        let neckInset = w * 0.16
        let neckHeight = h * 0.07
        let shoulder = h * 0.09
        let radius = w * 0.20

        var p = Path()
        p.move(to: CGPoint(x: rect.minX + neckInset, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - neckInset, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - neckInset, y: rect.minY + neckHeight))
        p.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY + neckHeight + shoulder),
            control: CGPoint(x: rect.maxX, y: rect.minY + neckHeight)
        )
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
        p.addQuadCurve(
            to: CGPoint(x: rect.maxX - radius, y: rect.maxY),
            control: CGPoint(x: rect.maxX, y: rect.maxY)
        )
        p.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
        p.addQuadCurve(
            to: CGPoint(x: rect.minX, y: rect.maxY - radius),
            control: CGPoint(x: rect.minX, y: rect.maxY)
        )
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + neckHeight + shoulder))
        p.addQuadCurve(
            to: CGPoint(x: rect.minX + neckInset, y: rect.minY + neckHeight),
            control: CGPoint(x: rect.minX, y: rect.minY + neckHeight)
        )
        p.closeSubpath()
        return p
    }
}

/// A filled region whose top edge is a sine wave. The wave sits inside the
/// top `2 * amplitude` points of the rect, and everything below it is filled.
struct WaveShape: Shape {
    var phase: Double
    var amplitude: CGFloat
    var wavelengths: Double = 1.3

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let midY = rect.minY + amplitude
        p.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: midY + CGFloat(sin(phase)) * amplitude))
        var x = rect.minX
        while x <= rect.maxX {
            let relative = Double((x - rect.minX) / max(rect.width, 1))
            let wave = sin(relative * Double.pi * 2 * wavelengths + phase)
            let y = midY + CGFloat(wave) * amplitude
            p.addLine(to: CGPoint(x: x, y: y))
            x += 2
        }
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

/// A glass jar filled to `progress` (0...1) with gently sloshing liquid.
struct JarView: View {
    var progress: Double
    var color: JarColor
    var animated: Bool = true

    var body: some View {
        GeometryReader { geo in
            let lidHeight = geo.size.height * 0.08
            let gap = geo.size.height * 0.015
            let bodyHeight = geo.size.height - lidHeight - gap
            let amplitude: CGFloat = max(geo.size.width * 0.025, 2)
            // Show a sliver of liquid as soon as there's anything in the jar,
            // and push the wave past the rim when it's full.
            let level: Double = progress <= 0 ? 0 : max(progress, 0.05)
            let liquidHeight: CGFloat = level >= 1
                ? bodyHeight + amplitude * 2
                : bodyHeight * CGFloat(level) + amplitude

            VStack(spacing: gap) {
                RoundedRectangle(cornerRadius: lidHeight * 0.35, style: .continuous)
                    .fill(color.color.opacity(0.85))
                    .overlay(
                        RoundedRectangle(cornerRadius: lidHeight * 0.35, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.25), lineWidth: 1)
                    )
                    .frame(width: geo.size.width * 0.76, height: lidHeight)

                ZStack(alignment: .bottom) {
                    JarShape()
                        .fill(color.color.opacity(0.08))

                    if level > 0 {
                        TimelineView(.animation(paused: !animated)) { context in
                            let t = context.date.timeIntervalSinceReferenceDate
                            ZStack {
                                WaveShape(phase: t * 1.6, amplitude: amplitude)
                                    .fill(color.color.opacity(0.35))
                                WaveShape(phase: t * 2.2 + 2.0, amplitude: amplitude * 0.8)
                                    .fill(color.fill)
                                    .padding(.top, amplitude * 0.5)
                            }
                        }
                        .frame(height: liquidHeight)
                        .transition(.opacity)
                    }
                }
                .frame(width: geo.size.width, height: bodyHeight, alignment: .bottom)
                .clipShape(JarShape())
                .overlay(
                    JarShape()
                        .stroke(color.color.opacity(0.55), lineWidth: max(geo.size.width * 0.018, 1.5))
                )
                .overlay(alignment: .topLeading) {
                    // Glass highlight.
                    Capsule()
                        .fill(Color.white.opacity(0.35))
                        .frame(width: geo.size.width * 0.05, height: bodyHeight * 0.45)
                        .offset(x: geo.size.width * 0.12, y: bodyHeight * 0.22)
                }
                .animation(.spring(response: 0.9, dampingFraction: 0.7), value: level)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .aspectRatio(0.78, contentMode: .fit)
        .accessibilityElement()
        .accessibilityLabel("Jar \(Int((progress * 100).rounded())) percent full")
    }
}

/// A coin that drops into the jar each time `trigger` changes.
struct CoinDrop: View {
    var trigger: Int
    var distance: CGFloat

    private struct Values {
        var y: CGFloat = 0
        var opacity: Double = 0
        var rotation: Double = 0
        var scale: CGFloat = 1
    }

    var body: some View {
        Text("🪙")
            .font(.system(size: 36))
            .keyframeAnimator(initialValue: Values(), trigger: trigger) { content, v in
                content
                    .scaleEffect(v.scale)
                    .rotation3DEffect(.degrees(v.rotation), axis: (x: 0, y: 1, z: 0))
                    .offset(y: v.y)
                    .opacity(v.opacity)
            } keyframes: { _ in
                KeyframeTrack(\.y) {
                    MoveKeyframe(-distance)
                    CubicKeyframe(distance * 0.35, duration: 0.55)
                }
                KeyframeTrack(\.opacity) {
                    MoveKeyframe(1)
                    LinearKeyframe(1, duration: 0.45)
                    LinearKeyframe(0, duration: 0.15)
                }
                KeyframeTrack(\.rotation) {
                    MoveKeyframe(0)
                    LinearKeyframe(540, duration: 0.6)
                }
                KeyframeTrack(\.scale) {
                    MoveKeyframe(1)
                    LinearKeyframe(1, duration: 0.45)
                    SpringKeyframe(0.6, duration: 0.15)
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// A burst of confetti that plays each time `trigger` changes.
struct ConfettiView: View {
    var trigger: Int

    private struct Piece {
        var x: Double        // 0...1 across the screen
        var vx: Double
        var vy: Double
        var spin: Double
        var size: Double
        var color: Color
    }

    @State private var pieces: [Piece] = []
    @State private var startDate: Date?

    private static let duration: TimeInterval = 3.2
    private static let palette: [Color] = JarColor.allCases.map(\.color) + [.white]

    var body: some View {
        TimelineView(.animation(paused: startDate == nil)) { context in
            Canvas { canvas, size in
                guard let startDate else { return }
                let t = context.date.timeIntervalSince(startDate)
                guard t < Self.duration else { return }
                let fade = t > Self.duration - 0.6 ? (Self.duration - t) / 0.6 : 1
                for piece in pieces {
                    var c = canvas
                    let x = CGFloat(piece.x) * size.width + CGFloat(piece.vx * t)
                    let y = CGFloat(-20 + piece.vy * t + 0.5 * 520 * t * t)
                    c.opacity = fade
                    c.translateBy(x: x, y: y)
                    c.rotate(by: .radians(piece.spin * t))
                    let s = CGFloat(piece.size)
                    let rect = CGRect(x: -s / 2, y: -s / 4, width: s, height: s / 2)
                    c.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(piece.color))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: trigger) {
            pieces = (0..<110).map { _ in
                Piece(
                    x: .random(in: 0...1),
                    vx: .random(in: -60...60),
                    vy: .random(in: -260 ... 40),
                    spin: .random(in: -9...9),
                    size: .random(in: 8...14),
                    color: Self.palette.randomElement() ?? .yellow
                )
            }
            let started = Date.now
            startDate = started
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.duration) {
                if startDate == started { startDate = nil }
            }
        }
    }
}

#Preview {
    HStack(spacing: 24) {
        JarView(progress: 0, color: .ocean)
        JarView(progress: 0.4, color: .mint)
        JarView(progress: 1, color: .berry)
    }
    .frame(height: 180)
    .padding()
}
