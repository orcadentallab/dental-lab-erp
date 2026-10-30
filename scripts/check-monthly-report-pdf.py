"""Checks real PDF output: native text, all rows, repeated headers, page bounds."""
from pathlib import Path
import re
import unicodedata

import pdfplumber
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
for relative, service_count in [
    ("output/pdf/monthly-report-preview.pdf", 18),
    ("tmp/pdfs/monthly-report-long-tables.pdf", 64),
]:
    path = root / relative
    reader = PdfReader(path)
    assert all(len(page.images) == 1 for page in reader.pages), "Every page must contain the lab logo only, with native text for the report"
    with pdfplumber.open(path) as pdf:
        texts = [unicodedata.normalize("NFKC", page.extract_text() or "") for page in pdf.pages]
        for index, page in enumerate(pdf.pages):
            assert len(page.chars) > 100, f"Empty/unreadable page {index + 1}"
            header = page.crop((0, 0, page.width, 100)).extract_text() or ""
            footer = page.crop((0, 790, page.width, page.height)).extract_text() or ""
            assert "ORCA Dental Lab" in header, f"Missing header on page {index + 1}"
            assert "01034141917" in header, f"Incorrect lab phone on page {index + 1}"
            assert all(image["top"] < 100 and image["bottom"] < 100 for image in page.images), "Report content must be native text; only the header logo may be an image"
            assert "2026" in header, f"Missing report year on page {index + 1}"
            assert "Africa/Cairo" in footer, f"Missing footer on page {index + 1}"
            assert all(-1 <= char["x0"] <= char["x1"] <= page.width + 1 for char in page.chars), f"Horizontal clipping on page {index + 1}"
            assert all(-1 <= char["top"] <= char["bottom"] <= page.height + 1 for char in page.chars), f"Vertical clipping on page {index + 1}"
        full_text = "\n".join(texts)
        # Extract the service column independently so line wrapping does not interleave numbers from adjacent columns.
        mm = 72 / 25.4
        financial_service_text = " ".join(" ".join((page.crop((131 * mm, 42 * mm, 186 * mm, 274 * mm)).extract_text() or "").split()) for page in pdf.pages)
        # English named service rows must appear both in the money table and the volume table.
        names = ["Zr Preshade", "Emax CAD", "PFM vm13", "PMMA Printed", "Orthodontic Retainer & Night Guard", None, "Scanner Rent"]
        for index in range(service_count):
            name = names[index % len(names)]
            if name:
                label = f"{name} {index + 1:02d}"
                assert label in financial_service_text and label in full_text, f"Missing service row: {label}"
        # On every continuation page, the column labels must still be present.
        table_pages = [text for text in texts if re.search(r"(?:Zr Preshade|Emax CAD|PFM vm13|Scanner Rent) \d{2}", text)]
        assert all("#" in text for text in table_pages), "Missing repeated table header"
        print(f"Verified {relative}: {len(pdf.pages)} pages, {service_count} services, native text, headers/footers, no clipping")
