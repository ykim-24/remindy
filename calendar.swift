// Reads upcoming calendar events via EventKit (expands recurring events,
// reads all synced accounts including Google). Prints JSON to stdout.
// Usage: swift calendar.swift [days]
import EventKit
import Foundation

let days = CommandLine.arguments.count > 1 ? (Double(CommandLine.arguments[1]) ?? 7) : 7
let store = EKEventStore()
let sem = DispatchSemaphore(value: 0)
var granted = false

store.requestFullAccessToEvents { ok, _ in
  granted = ok
  sem.signal()
}
sem.wait()

guard granted else {
  print("{\"error\":\"no-access\"}")
  exit(2)
}

let now = Date()
let horizon = now.addingTimeInterval(days * 24 * 3600)
let pred = store.predicateForEvents(withStart: now, end: horizon, calendars: nil)
let events = store.events(matching: pred).sorted { $0.startDate < $1.startDate }

func esc(_ s: String?) -> String {
  return (s ?? "").replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
    .replacingOccurrences(of: "\n", with: " ")
}

var out: [String] = []
for e in events {
  let start = e.startDate.timeIntervalSince1970
  out.append(
    "{\"title\":\"\(esc(e.title))\",\"start\":\(start),\"allDay\":\(e.isAllDay),\"calendar\":\"\(esc(e.calendar.title))\"}"
  )
}
print("[" + out.joined(separator: ",") + "]")
