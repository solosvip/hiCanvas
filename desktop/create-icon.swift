import AppKit

// 简洁画板图标：沿用画板工具的蓝色选中态与白色纸面。
let directory = CommandLine.arguments[1]
let fm = FileManager.default
try fm.createDirectory(atPath: directory, withIntermediateDirectories: true)
for size in [16, 32, 64, 128, 256, 512, 1024] {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let scale = CGFloat(size) / 1024
    NSAffineTransform(transform: AffineTransform(scale: scale)).concat()
    NSColor(calibratedRed: 0.19, green: 0.49, blue: 0.94, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 56, y: 56, width: 912, height: 912), xRadius: 200, yRadius: 200).fill()
    NSColor.white.setFill()
    NSBezierPath(roundedRect: NSRect(x: 222, y: 226, width: 580, height: 572), xRadius: 62, yRadius: 62).fill()
    NSColor(calibratedRed: 0.19, green: 0.49, blue: 0.94, alpha: 1).setStroke()
    let path = NSBezierPath()
    path.lineWidth = 36
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    path.move(to: NSPoint(x: 294, y: 352))
    path.line(to: NSPoint(x: 440, y: 498))
    path.line(to: NSPoint(x: 548, y: 390))
    path.line(to: NSPoint(x: 730, y: 572))
    path.stroke()
    NSColor(calibratedRed: 0.19, green: 0.49, blue: 0.94, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: 322, y: 604, width: 100, height: 100)).fill()
    image.unlockFocus()
    guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("图标生成失败") }
    let names: [String]
    switch size {
    case 16: names = ["icon_16x16.png"]
    case 32: names = ["icon_16x16@2x.png", "icon_32x32.png"]
    case 64: names = ["icon_32x32@2x.png"]
    case 128: names = ["icon_128x128.png"]
    case 256: names = ["icon_128x128@2x.png", "icon_256x256.png"]
    case 512: names = ["icon_256x256@2x.png", "icon_512x512.png"]
    default: names = ["icon_512x512@2x.png"]
    }
    for name in names { try png.write(to: URL(fileURLWithPath: directory).appendingPathComponent(name)) }
}
