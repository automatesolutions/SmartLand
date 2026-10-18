"""What each kind of listing asks for, which documents back it up, how the
credibility score adds up, and the fingerprint chain that records every change.

The frontend reads CATEGORIES and DOCUMENTS from GET /api/listings/schema, so
the form and the server always agree on the fields.
"""

import hashlib
import json

# Kinds of property people can post. `rent` listings are priced per month.
# Each field: key, label, type (number | select | bool | text | date), and
# optional unit, options, required, min, max, hint.
_TITLE_TYPE = {
    "key": "title_type",
    "label": "Ownership document",
    "type": "select",
    "options": ["TCT (clean title)", "OCT", "CCT (condo)", "CLOA", "Tax declaration only", "Deed of sale only", "Mother title (not yet split)"],
    "hint": "The document that shows who owns the property.",
}
_ROAD = {"key": "road_access", "label": "Road access", "type": "select", "options": ["Concrete road", "Asphalt road", "Gravel road", "Dirt road", "Footpath only", "None"]}
_LOT = {"key": "lot_sqm", "label": "Lot area", "type": "number", "unit": "sqm", "required": True, "min": 1, "hint": "1 hectare is 10,000 sqm."}
_FLOOR = {"key": "floor_sqm", "label": "Floor area", "type": "number", "unit": "sqm", "min": 1}
_WATER = {"key": "water", "label": "Water", "type": "select", "options": ["Water district", "Deep well", "Spring or river", "None yet"]}
_POWER = {"key": "power", "label": "Electricity", "type": "select", "options": ["Connected", "Lines nearby", "None yet"]}
_MIN_LEASE = {"key": "min_lease_months", "label": "Shortest lease", "type": "number", "unit": "months", "min": 1}
_DEPOSIT = {"key": "deposit_months", "label": "Deposit", "type": "number", "unit": "months", "min": 0, "max": 12}
_ADVANCE = {"key": "advance_months", "label": "Advance rent", "type": "number", "unit": "months", "min": 0, "max": 12}

CATEGORIES = {
    "farm_lot": {
        "label": "Farm lot for sale",
        "rent": False,
        "fields": [
            _LOT,
            {"key": "current_use", "label": "Current use", "type": "select", "options": ["Coconut", "Rice", "Corn", "Fruit trees", "Vegetables", "Livestock", "Fishpond", "Idle or grassland", "Mixed"]},
            {"key": "topography", "label": "Terrain", "type": "select", "options": ["Flat", "Rolling", "Hilly", "Mountainous"]},
            _ROAD,
            _WATER,
            _POWER,
            _TITLE_TYPE,
        ],
    },
    "house_sale": {
        "label": "House for sale",
        "rent": False,
        "fields": [
            _LOT,
            {**_FLOOR, "required": True},
            {"key": "bedrooms", "label": "Bedrooms", "type": "number", "required": True, "min": 0, "max": 50},
            {"key": "bathrooms", "label": "Bathrooms", "type": "number", "required": True, "min": 0, "max": 50},
            {"key": "storeys", "label": "Storeys", "type": "number", "min": 1, "max": 10},
            {"key": "parking", "label": "Parking slots", "type": "number", "min": 0, "max": 20},
            {"key": "year_built", "label": "Year built", "type": "number", "min": 1900, "max": 2100},
            {"key": "furnished", "label": "Furnishing", "type": "select", "options": ["Unfurnished", "Semi-furnished", "Fully furnished"]},
            _TITLE_TYPE,
        ],
    },
    "house_rent": {
        "label": "House for rent",
        "rent": True,
        "fields": [
            {**_FLOOR, "required": True},
            {"key": "bedrooms", "label": "Bedrooms", "type": "number", "required": True, "min": 0, "max": 50},
            {"key": "bathrooms", "label": "Bathrooms", "type": "number", "required": True, "min": 0, "max": 50},
            {"key": "furnished", "label": "Furnishing", "type": "select", "options": ["Unfurnished", "Semi-furnished", "Fully furnished"]},
            _DEPOSIT,
            _ADVANCE,
            _MIN_LEASE,
            {"key": "pets_allowed", "label": "Pets allowed", "type": "bool"},
            {"key": "available_from", "label": "Available from", "type": "date"},
        ],
    },
    "land_lease": {
        "label": "Land for rent or lease",
        "rent": True,
        "fields": [
            _LOT,
            {"key": "allowed_use", "label": "Allowed use", "type": "select", "required": True, "options": ["Farming", "Commercial", "Residential", "Parking", "Storage or yard", "Any legal use"]},
            {"key": "min_lease_years", "label": "Shortest lease", "type": "number", "unit": "years", "min": 1, "max": 99},
            _ROAD,
            _WATER,
            _POWER,
        ],
    },
    "commercial_sale": {
        "label": "Commercial building or warehouse for sale",
        "rent": False,
        "fields": [
            _LOT,
            {**_FLOOR, "required": True},
            {"key": "building_type", "label": "Building", "type": "select", "required": True, "options": ["Commercial building", "Warehouse", "Office building", "Shophouse", "Mixed use"]},
            {"key": "storeys", "label": "Storeys", "type": "number", "min": 1, "max": 60},
            {"key": "frontage_m", "label": "Road frontage", "type": "number", "unit": "m", "min": 0},
            {"key": "ceiling_m", "label": "Ceiling height", "type": "number", "unit": "m", "min": 0},
            {"key": "loading_bays", "label": "Loading bays", "type": "number", "min": 0, "max": 100},
            _ROAD,
            _TITLE_TYPE,
        ],
    },
    "warehouse_lease": {
        "label": "Warehouse for lease",
        "rent": True,
        "fields": [
            {**_FLOOR, "required": True},
            {"key": "ceiling_m", "label": "Ceiling height", "type": "number", "unit": "m", "min": 0},
            {"key": "loading_bays", "label": "Loading bays", "type": "number", "min": 0, "max": 100},
            {"key": "truck_access", "label": "Biggest truck that fits", "type": "select", "options": ["Van", "Elf truck", "10-wheeler", "Trailer"]},
            {"key": "three_phase_power", "label": "Three-phase power", "type": "bool"},
            _DEPOSIT,
            _ADVANCE,
            _MIN_LEASE,
        ],
    },
    "beach": {
        "label": "Beach property for sale",
        "rent": False,
        "fields": [
            _LOT,
            {"key": "beach_frontage_m", "label": "Beach frontage", "type": "number", "unit": "m", "required": True, "min": 1},
            {"key": "shore", "label": "Shore", "type": "select", "options": ["White sand", "Fine sand", "Pebbles", "Rocky", "Mangrove"]},
            _ROAD,
            _WATER,
            _POWER,
            _TITLE_TYPE,
        ],
    },
    "foreclosure": {
        "label": "Pag-IBIG or bank foreclosure",
        "rent": False,
        "fields": [
            _LOT,
            _FLOOR,
            {"key": "occupied", "label": "Currently occupied", "type": "bool"},
            {"key": "bidding_date", "label": "Bidding or sale date", "type": "date"},
            _TITLE_TYPE,
        ],
    },
}

# Old category names, renamed when the database opens
RENAMED = {"commercial": "commercial_sale", "building_warehouse": "commercial_sale"}

DOCUMENTS = {
    "title": {"label": "Land title (TCT, OCT, or CCT)", "hint": "Check the title number against a certified true copy from the Registry of Deeds."},
    "rights": {"label": "Proof of rights (CLOA, deed of sale, or similar)", "hint": "For land without its own title yet."},
    "tax_declaration": {"label": "Tax declaration", "hint": "From the city or municipal assessor."},
    "tax_clearance": {"label": "Real property tax clearance or latest receipt", "hint": "Shows the property tax is paid."},
    "survey_plan": {"label": "Lot plan or survey", "hint": "Shows the boundaries and the lot's technical description."},
    "other": {"label": "Other document", "hint": "Permits, a special power of attorney, or anything else that helps."},
}

ALLOWED_TYPES = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_DOCUMENTS = 12


def validate_details(category: str, details: dict) -> dict:
    """Keeps only the fields this category asks for, checked against their
    rules. Raises ValueError with a sentence a person can act on."""
    clean = {}
    for f in CATEGORIES[category]["fields"]:
        if f["key"] in ("lot_sqm", "floor_sqm"):
            continue  # stored in their own columns
        value = details.get(f["key"])
        if value in (None, ""):
            if f.get("required"):
                raise ValueError(f"Enter the {f['label'].lower()}.")
            continue
        if f["type"] == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{f['label']} must be a number.")
            if "min" in f and value < f["min"] or "max" in f and value > f["max"]:
                raise ValueError(f"{f['label']} is out of range.")
        elif f["type"] == "select":
            if value not in f["options"]:
                raise ValueError(f"Pick one of the choices for {f['label'].lower()}.")
        elif f["type"] == "bool":
            if not isinstance(value, bool):
                raise ValueError(f"{f['label']} must be yes or no.")
        elif f["type"] == "date":
            if not isinstance(value, str) or len(value) != 10:
                raise ValueError(f"{f['label']} must be a date.")
        elif f["type"] == "text":
            value = str(value)[:200]
        clean[f["key"]] = value
    return clean


def required_areas(category: str) -> dict[str, bool]:
    keys = {f["key"]: bool(f.get("required")) for f in CATEGORIES[category]["fields"]}
    return {"lot_sqm": keys.get("lot_sqm", False), "floor_sqm": keys.get("floor_sqm", False)}


# Credibility score -------------------------------------------------------------
#
# How much of a listing has documents behind it, 0 to 100. A document a
# SmartLand reviewer checked against the issuing office counts far more than
# one that was only uploaded, since anyone can upload a fake. Rejected
# documents count for nothing.

# Points per document: (if uploaded, once a reviewer checked it). Proof of
# ownership counts whichever of the land title or the proof of rights scores higher.
SCORING = {
    "title": {"label": "Land title", "uploaded": 15, "verified": 40},
    "rights": {"label": "Proof of rights", "uploaded": 10, "verified": 30},
    "tax_declaration": {"label": "Tax declaration", "uploaded": 5, "verified": 15},
    "tax_clearance": {"label": "Property tax paid", "uploaded": 5, "verified": 15},
    "survey_plan": {"label": "Lot plan or survey", "uploaded": 3, "verified": 10},
}


def _doc_points(docs: list[dict], kind: str) -> tuple[int, str]:
    statuses = [d["status"] for d in docs if d["type"] == kind]
    rule = SCORING[kind]
    if "verified" in statuses:
        return rule["verified"], "verified"
    if "pending" in statuses:
        return rule["uploaded"], "uploaded"
    if "rejected" in statuses:
        return 0, "rejected"
    return 0, "missing"


def credibility(listing: dict, docs: list[dict]) -> dict:
    title_pts, title_state = _doc_points(docs, "title")
    rights_pts, rights_state = _doc_points(docs, "rights")
    use_rights = rights_pts > title_pts or (title_state == "missing" and rights_state != "missing")
    own_pts, own_state, own_label = (rights_pts, rights_state, "proof of rights") if use_rights else (title_pts, title_state, "land title")
    items = [{"key": "ownership", "label": f"Proof of ownership ({own_label})", "points": own_pts, "max": SCORING["title"]["verified"], "state": own_state}]
    for kind in ("tax_declaration", "tax_clearance", "survey_plan"):
        pts, state = _doc_points(docs, kind)
        items.append({"key": kind, "label": SCORING[kind]["label"], "points": pts, "max": SCORING[kind]["verified"], "state": state})

    has_area = bool(listing.get("lot_sqm") or listing.get("floor_sqm"))
    items.append({"key": "details", "label": "Exact pin and area", "points": 10 if has_area else 5, "max": 10, "state": "complete" if has_area else "partial"})
    identified = (listing.get("seller_type") == "broker" and listing.get("prc_license")) or listing.get("seller_type") in ("bank", "developer")
    items.append({"key": "seller", "label": "Seller identified", "points": 10 if identified else 5, "max": 10, "state": "complete" if identified else "partial"})

    score = sum(i["points"] for i in items)
    level = "Strong" if score >= 80 else "Good" if score >= 60 else "Fair" if score >= 30 else "Low"
    return {"score": score, "level": level, "items": items}


# Fingerprint chain --------------------------------------------------------------
#
# Every change to a listing is an event. Each event's fingerprint covers its
# own content and the previous event's fingerprint, so editing or removing any
# past event breaks every fingerprint after it.

def canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def event_hash(prev_hash: str, seq: int, kind: str, payload: dict, created_at: str) -> str:
    body = canonical({"prev": prev_hash, "seq": seq, "kind": kind, "payload": payload, "at": created_at})
    return hashlib.sha256(body.encode()).hexdigest()


GENESIS = "0" * 64


def verify_chain(events: list[dict]) -> bool:
    prev = GENESIS
    for e in events:
        if e["prev_hash"] != prev or event_hash(prev, e["seq"], e["kind"], e["payload"], e["created_at"]) != e["hash"]:
            return False
        prev = e["hash"]
    return True
