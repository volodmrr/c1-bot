// Kyiv date "YYYY-MM-DD" (en-CA → ISO, sorts directly). Gates one run per posting day.
const KYIV_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Europe/Kyiv',
})

export function kyivDate(iso?: string): string {
  return KYIV_DATE.format(iso ? new Date(iso) : new Date())
}
