export function unreadCount(ids: string[], seen: Set<string>) {
  return ids.filter((id) => !seen.has(id)).length;
}
