#!/usr/bin/env python3
"""
Build a course-specific vocab from a single iNaturalist project.

Target: 2025 floristik & faunistik project:
https://www.inaturalist.se/projects/2025-floristik-och-faunistik-pa-kau-big001-bigbi1-bign10

Result:
  data/course_2025/course_2025_vocab.json

Schema matches the species-level vocabs you already use:

[
  {
    "scientificName": "Anoplotrupes stercorosus",
    "swedishName": "Skogstordyvel",
    "genusName": "Anoplotrupes",
    "familyName": "Geotrupidae",
    "familyScientificName": "Geotrupidae",
    "familySwedishName": "tordyvlar",
    "orderScientificName": "Coleoptera",
    "orderSwedishName": "Skalbaggar",
    "classScientificName": "Insecta",
    "classSwedishName": "egentliga insekter",
    "rank": "species",
    "taxonId": 125655,
    "obsCount": 42,
    "exampleObservation": {
      "obsId": 328232905,
      "photoUrl": ".../large.jpg",
      "observer": "some_user",
      "licenseCode": "cc-by-nc",
      "obsUrl": "https://www.inaturalist.org/observations/328232905"
    }
  },
  ...
]
"""

import json
import os
import time
from typing import Any, Dict, List, Optional

import requests

INAT_BASE = "https://api.inaturalist.org/v1"

# Your 2025 course project slug (works as project_id in API)
COURSE_PROJECT_SLUG = "2025-floristik-och-faunistik-pa-kau-big001-bigbi1-bign10"

# Where to write the JSON
OUTPUT_DIR = os.path.join("data", "course_2025")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "course_2025_vocab.json")

MAX_SPECIES_PAGES = 5        # enough for most course projects
MAX_RETRIES_PER_REQUEST = 5
INITIAL_BACKOFF_SECONDS = 1.0

CONFIG_ALLOWED_LICENSES = ["cc0", "cc-by", "cc-by-nc"]


def ensure_output_dir(path: str) -> None:
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)


def write_json(obj: Any, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


# --------------------------------------------
# 1. species_counts for this project
# --------------------------------------------

def fetch_species_counts_for_project(
    project_id: str,
    per_page: int = 200,
    locale: str = "sv",
) -> List[Dict[str, Any]]:
    """
    Use /observations/species_counts with project_id to get species + counts
    from the course project.
    """
    results: List[Dict[str, Any]] = []
    page = 1

    while True:
        if page > MAX_SPECIES_PAGES:
            print(f"  Reached MAX_SPECIES_PAGES={MAX_SPECIES_PAGES}, stopping.")
            break

        params = {
            "project_id": project_id,
            "per_page": per_page,
            "page": page,
            "verifiable": "true",
            "locale": locale,
            "order_by": "observations_count",
            "order": "desc",
        }

        print(
            f"Requesting project species_counts for project_id={project_id}, "
            f"page={page}, per_page={per_page}..."
        )

        attempt = 0
        while True:
            resp = requests.get(f"{INAT_BASE}/observations/species_counts", params=params)

            if resp.status_code == 429:
                attempt += 1
                if attempt > MAX_RETRIES_PER_REQUEST:
                    raise requests.HTTPError(
                        f"Exceeded max retries ({MAX_RETRIES_PER_REQUEST}) after 429 "
                        f"for project_id={project_id}, page={page}"
                    )
                wait = INITIAL_BACKOFF_SECONDS * (2 ** (attempt - 1))
                print(f"    429 throttling. Sleeping {wait:.1f}s before retry...")
                time.sleep(wait)
                continue

            resp.raise_for_status()
            break

        data = resp.json()
        page_results = data.get("results", [])
        if not page_results:
            break

        results.extend(page_results)

        total = data.get("total_results", 0)
        if page * per_page >= total:
            break

        page += 1
        time.sleep(0.2)

    return results


# --------------------------------------------
# 2. Taxon details for taxonomy (class/order/family)
# --------------------------------------------

def fetch_taxon_details(taxon_ids: List[int]) -> Dict[int, Dict[str, Any]]:
    """
    Same idea as in build_vocab.py: /v1/taxa/<ids> to get ancestors.
    """
    result: Dict[int, Dict[str, Any]] = {}
    if not taxon_ids:
        return result

    chunk_size = 30
    for i in range(0, len(taxon_ids), chunk_size):
        chunk = taxon_ids[i:i + chunk_size]
        url = f"{INAT_BASE}/taxa/{','.join(str(t) for t in chunk)}"
        params = {
            "locale": "sv",
        }

        print(f"  Enriching taxonomy for taxon_ids {chunk[0]}..{chunk[-1]}")

        resp = requests.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

        for t in data.get("results", []):
            result[t["id"]] = t

        time.sleep(0.2)

    return result


# --------------------------------------------
# 3. Example observation per species FROM THIS PROJECT
# --------------------------------------------

def fetch_example_observation_for_species_in_project(
    taxon_id: int,
    project_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Fetch a single example observation with photo for this species (taxon_id)
    from the specified project (project_id).
    """

    params: Dict[str, Any] = {
        "taxon_id": taxon_id,
        "project_id": project_id,
        "photos": "true",
        "per_page": 30,
        "order": "desc",
        "order_by": "created_at",
        "locale": "sv",
        "quality_grade": "research",
    }

    print(f"  Fetching example observation in project for taxon_id={taxon_id}...")

    resp = requests.get(f"{INAT_BASE}/observations", params=params)
    if resp.status_code == 429:
        print(f"    429 throttling, sleeping 2s...")
        time.sleep(2.0)
        resp = requests.get(f"{INAT_BASE}/observations", params=params)

    resp.raise_for_status()
    data = resp.json()
    results = data.get("results", [])
    if not results:
        return None

    raw = results[0]
    photos = raw.get("photos") or []
    if not photos:
        return None

    # Prefer allowed licenses, else take first photo
    photo = None
    for p in photos:
        code = (p.get("license_code") or raw.get("license_code") or "").lower()
        if code in CONFIG_ALLOWED_LICENSES:
            photo = p
            break
    if photo is None:
        photo = photos[0]

    url = photo.get("url")
    if not url:
        return None
    photo_url = url.replace("square.", "large.")

    observer = (raw.get("user") or {}).get("login") or "unknown"
    license_code = photo.get("license_code") or raw.get("license_code")

    return {
        "obsId": raw.get("id"),
        "photoUrl": photo_url,
        "observer": observer,
        "licenseCode": license_code,
        "obsUrl": f"https://www.inaturalist.org/observations/{raw.get('id')}",
    }


# --------------------------------------------
# 4. Build the course vocab
# --------------------------------------------

def build_course_vocab(project_slug: str) -> List[Dict[str, Any]]:
    species_counts = fetch_species_counts_for_project(project_slug)
    print(f"  Got {len(species_counts)} species-level rows from project.")

    # Deduplicate by taxonId (should already be unique, but let's be safe)
    species_map: Dict[int, Dict[str, Any]] = {}
    for item in species_counts:
        taxon = item.get("taxon") or {}
        tid = taxon.get("id")
        if not tid:
            continue
        count = int(item.get("count") or 0)
        existing = species_map.get(tid)
        if existing is None or count > existing.get("count", 0):
            species_map[tid] = {
                "taxon": taxon,
                "count": count,
            }

    species_list = list(species_map.values())
    species_list.sort(key=lambda x: x["count"], reverse=True)
    print(f"  Unique species in project: {len(species_list)}")

    taxon_ids_list = [
        e["taxon"]["id"] for e in species_list if e["taxon"].get("id") is not None
    ]
    tax_details = fetch_taxon_details(taxon_ids_list)

    vocab: List[Dict[str, Any]] = []

    for entry in species_list:
        taxon = entry["taxon"]
        tid = taxon.get("id")
        if not tid:
            continue

        sci = taxon.get("name")
        if not sci:
            continue

        sw = taxon.get("preferred_common_name")
        genus_name = sci.split(" ")[0]

        enriched = tax_details.get(tid, taxon)
        ancestors = enriched.get("ancestors") or []

        family_scientific_name = None
        family_swedish_name = None
        order_scientific_name = None
        order_swedish_name = None
        class_scientific_name = None
        class_swedish_name = None

        for anc in ancestors:
            rank = anc.get("rank")
            if rank == "family" and family_scientific_name is None:
                family_scientific_name = anc.get("name")
                family_swedish_name = anc.get("preferred_common_name")
            elif rank == "order" and order_scientific_name is None:
                order_scientific_name = anc.get("name")
                order_swedish_name = anc.get("preferred_common_name")
            elif rank == "class" and class_scientific_name is None:
                class_scientific_name = anc.get("name")
                class_swedish_name = anc.get("preferred_common_name")

        example_obs = fetch_example_observation_for_species_in_project(
            taxon_id=tid,
            project_id=project_slug,
        )
        if example_obs is None:
            print(f"    -> No usable project observation found for {sci}, skipping.")
            continue

        vocab.append(
            {
                "scientificName": sci,
                "swedishName": sw,
                "genusName": genus_name,
                "familyName": family_scientific_name,  # backward compatible
                "familyScientificName": family_scientific_name,
                "familySwedishName": family_swedish_name,
                "orderScientificName": order_scientific_name,
                "orderSwedishName": order_swedish_name,
                "classScientificName": class_scientific_name,
                "classSwedishName": class_swedish_name,
                "rank": enriched.get("rank"),
                "taxonId": tid,
                "obsCount": entry["count"],
                "exampleObservation": example_obs,
            }
        )

    print(f"  Built course vocab with {len(vocab)} species.")
    return vocab


def main() -> None:
    ensure_output_dir(OUTPUT_DIR)
    print(f"Building course vocab for project '{COURSE_PROJECT_SLUG}'")

    vocab = build_course_vocab(COURSE_PROJECT_SLUG)
    write_json(vocab, OUTPUT_FILE)

    print(f"\nDone. Wrote {len(vocab)} entries to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
