# Cloudflare Functions

This folder hosts the Cloudflare worker functions that back the sticker and payday endpoints.

## `api/sticker`
Returns sticker punch guidance based on the "last Sunday" rule used by the UI.

**Query parameters**
- `date` (`YYYY-MM-DD`, optional): Evaluate a specific date instead of "now".
- `useFullMonthName` (boolean, optional): Return the full month name in the `answer` array instead of the single-letter code.
- `quiet` (boolean, optional): Return only the `answer` array, omitting the `factors` object.

**Response shape**
```
{
  "answer": ["J", 1],
  "factors": {
    "month": "January",
    "monthNumber": 1,
    "monthLetter": "J",
    "year": 2024,
    "week": 1,
    "lastSunday": "2024-01-28",
    "evaluatedDate": "2024-01-31"
  }
}
```

The `answer` array adapts to the provided query flags and `quiet` removes the `factors` block entirely.

## `api/payday`
Calculates a bi-weekly payday schedule anchored to the configured `START_DATE_STRING`. It returns the nearest payday (which may be today), the subsequent payday, and a flag indicating whether today is a payday.
