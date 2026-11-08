"""The blank Excel template for logging a month by hand and uploading it through Import.

Its headings are ones the importer recognises on its own (Date, Description, Debit, Credit,
Category), so the column mapping fills itself in. Built in memory with openpyxl.
"""

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

HEADERS = ["Date", "Description", "Debit (money out)", "Credit (money in)", "Category"]
WIDTHS = [14, 40, 20, 20, 22]
ROWS = 500  # pre-formatted rows: plenty for a month
NAVY, ACCENT, MUTED = "0C2547", "BFE2FF", "6B7280"
# Excel number format with Indian grouping (12,34,567.00): one section per size band.
INR_FORMAT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00'

EXAMPLES = [
    ("01/11/2026", "Salary for November", "", "85000", "Salary"),
    ("02/11/2026", "Swiggy dinner", "450", "", "Food"),
    ("03/11/2026", "Electricity bill", "1820.50", "", "Utilities"),
    ("05/11/2026", "Refund from Amazon", "", "299", "Shopping"),
]

HOW_TO = [
    "How to fill the Transactions sheet",
    "",
    "1. One row per transaction. Leave the heading row as it is.",
    "2. Date: day first, e.g. 03/11/2026 (or pick it with Excel's date format).",
    "3. Description: what it was — shown in Planner, and used to spot duplicates.",
    "4. Fill ONE of the two amount columns: Debit for money out, Credit for money in. Positive numbers only.",
    "5. Category (optional): pick from the dropdown — the names match your categories in Planner.",
    "6. One file = one account or card. You choose which when you upload.",
    "7. In Planner: Transactions → Import → choose this file. Review the rows, then Import.",
    "",
    "Examples (this sheet is never imported):",
]


def build_template(categories: list[str]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Transactions"

    # ---- Heading row ----
    ws.append(HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 22
    ws.freeze_panes = "A2"  # the headings stay visible while scrolling
    for i, width in enumerate(WIDTHS):
        ws.column_dimensions[chr(65 + i)].width = width

    # ---- Formats and checks on the empty rows ----
    last = ROWS + 1
    for row in range(2, last + 1):
        ws.cell(row, 1).number_format = "DD/MM/YYYY"
        ws.cell(row, 3).number_format = INR_FORMAT
        ws.cell(row, 4).number_format = INR_FORMAT

    amounts = DataValidation(type="decimal", operator="greaterThan", formula1="0", allow_blank=True,
                             showErrorMessage=True, errorTitle="Amount", error="Enter a positive amount (no minus sign).")
    amounts.add(f"C2:D{last}")
    ws.add_data_validation(amounts)

    if categories:
        # The dropdown reads its options from a hidden sheet, so names can contain commas.
        lists = wb.create_sheet("Categories")
        lists.append(["Category"])
        for name in categories:
            lists.append([name])
        lists.sheet_state = "hidden"
        dropdown = DataValidation(type="list", formula1=f"=Categories!$A$2:$A${len(categories) + 1}", allow_blank=True,
                                  showErrorMessage=False)  # a typed name not in the list is allowed (flagged on import)
        dropdown.add(f"E2:E{last}")
        ws.add_data_validation(dropdown)

    # ---- Instructions + examples on their own sheet ----
    how = wb.create_sheet("How to fill")
    for line in HOW_TO:
        how.append([line])
    how["A1"].font = Font(bold=True, size=14, color=NAVY)
    how.append(HEADERS)
    header_row = how.max_row
    for cell in how[header_row]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor=ACCENT)
    for example in EXAMPLES:
        how.append(list(example))
    for row in how.iter_rows(min_row=header_row + 1):
        for cell in row:
            cell.font = Font(color=MUTED)
    how.column_dimensions["A"].width = 14
    how.column_dimensions["B"].width = 40
    for col in "CDE":
        how.column_dimensions[col].width = 20

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
