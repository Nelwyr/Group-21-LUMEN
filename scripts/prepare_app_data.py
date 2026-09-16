"""Prepare privacy-safe, application-ready extracts from the case data.

The customer extract deliberately excludes respondent IDs, names, and e-mail
addresses. It contains only city and segment-by-city aggregates.
"""

from __future__ import annotations

import csv
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_DIR = DATA_DIR / "app_data"

CUSTOMER_INPUT = DATA_DIR / "customer_survey.csv"
SALES_INPUT = DATA_DIR / "historical_sales_weekly.csv"
CHANNEL_ECONOMICS_INPUT = DATA_DIR / "channel_economics.csv"
PRICE_TEST_INPUT = DATA_DIR / "price_test_results.csv"
MARKETING_FUNNEL_INPUT = DATA_DIR / "marketing_funnel_monthly.csv"
CUSTOMER_OUTPUT = OUTPUT_DIR / "customer_segment_city_aggregates.csv"
CITY_OUTPUT = OUTPUT_DIR / "customer_city_aggregates.csv"
SALES_OUTPUT = OUTPUT_DIR / "historical_sales_weekly_deduplicated.csv"
SIMULATOR_ASSUMPTIONS_OUTPUT = OUTPUT_DIR / "simulator_assumptions.json"
CITY_PRIORITISATION_OUTPUT = OUTPUT_DIR / "city_prioritisation.json"
LAUNCH_WINDOW_OUTPUT = OUTPUT_DIR / "launch_window.json"
PRICE_POSITIONING_OUTPUT = OUTPUT_DIR / "price_positioning.json"
STRATEGY_EVIDENCE_OUTPUT = OUTPUT_DIR / "strategy_evidence.json"

CHANNELS = ("DTC Online", "Retail/Grocery", "Gym & Office")
NUMERIC_FIELDS = (
    "age",
    "purchase_frequency_per_month",
    "monthly_beverage_spend_eur",
    "price_sensitivity_1_10",
    "lumen_purchase_intent_1_10",
)
AWARENESS_FIELDS = (
    "aware_pulsup",
    "aware_matelibre",
    "aware_voltfit",
    "aware_rootandrise",
)


def percentage(value: float) -> str:
    return f"{value:.1f}"


def is_true(value: str) -> bool:
    """Accept common CSV encodings for boolean survey fields."""
    return value.strip().lower() in {"1", "true", "yes"}


def sample_reliability(count: int) -> str:
    """Classify segment evidence according to the agreed sample-size rule."""
    if count >= 15:
        return "reliable"
    if count >= 8:
        return "directional_small_sample"
    return "insufficient"


def summarise_group(
    group: list[dict[str, str]], *, city: str, segment: str | None = None
) -> dict[str, str | int]:
    channel_counts = Counter(row["preferred_channel"] for row in group)
    result: dict[str, str | int] = {
        "city": city,
        "respondent_count": len(group),
        "sample_reliability": sample_reliability(len(group)),
        "most_preferred_channel": sorted(
            channel_counts, key=lambda channel: (-channel_counts[channel], channel)
        )[0],
    }
    if segment is not None:
        result["segment"] = segment
    else:
        result["wellness_respondent_count"] = sum(
            row["segment"] == "Urban Wellness Professionals" for row in group
        )
    for field in NUMERIC_FIELDS:
        result[f"avg_{field}"] = percentage(mean(float(row[field]) for row in group))
    for channel in CHANNELS:
        output_name = f"pct_prefer_{channel.lower().replace(' ', '_').replace('/', '_')}"
        result[output_name] = percentage(100 * channel_counts[channel] / len(group))
    for field in AWARENESS_FIELDS:
        result[f"pct_{field}"] = percentage(
            100 * sum(is_true(row[field]) for row in group) / len(group)
        )
    return result


def aggregate_customer_survey() -> int:
    with CUSTOMER_INPUT.open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))

    groups: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        groups[(row["segment"], row["city"])].append(row)

    metrics_fields = [
        "respondent_count",
        "sample_reliability",
        "avg_age",
        "avg_purchase_frequency_per_month",
        "avg_monthly_beverage_spend_eur",
        "avg_price_sensitivity_1_10",
        "avg_lumen_purchase_intent_1_10",
        "most_preferred_channel",
        *[f"pct_prefer_{channel.lower().replace(' ', '_').replace('/', '_')}" for channel in CHANNELS],
        *[f"pct_{field}" for field in AWARENESS_FIELDS],
    ]
    segment_output_fields = [
        "segment",
        "city",
        *metrics_fields,
    ]

    with CUSTOMER_OUTPUT.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=segment_output_fields)
        writer.writeheader()
        for (segment, city), group in sorted(groups.items()):
            writer.writerow(summarise_group(group, segment=segment, city=city))

    city_groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        city_groups[row["city"]].append(row)
    with CITY_OUTPUT.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=["city", *metrics_fields, "wellness_respondent_count"])
        writer.writeheader()
        for city, group in sorted(city_groups.items()):
            writer.writerow(summarise_group(group, city=city))

    return len(rows)


def deduplicate_sales() -> tuple[int, int]:
    with SALES_INPUT.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        fieldnames = reader.fieldnames
        if fieldnames is None:
            raise ValueError("historical_sales_weekly.csv has no header row")
        rows = list(reader)

    seen: set[tuple[str, ...]] = set()
    unique_rows: list[dict[str, str]] = []
    for row in rows:
        row_key = tuple(row[field] for field in fieldnames)
        if row_key not in seen:
            seen.add(row_key)
            unique_rows.append(row)

    with SALES_OUTPUT.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(unique_rows)

    return len(rows), len(unique_rows)


def write_simulator_assumptions() -> None:
    """Export only the aggregated model inputs needed by the simulator engine."""
    with CHANNEL_ECONOMICS_INPUT.open(encoding="utf-8", newline="") as source:
        channel_rows = list(csv.DictReader(source))
    channel_economics: dict[str, dict[str, float]] = {}
    for row in channel_rows:
        channel_economics.setdefault(
            row["channel"],
            {
                "retailer_margin_pct": float(row["retailer_margin_pct"]),
                "distributor_cut_pct": float(row["distributor_cut_pct"]),
                "payment_processing_pct": float(row["payment_processing_pct"]),
                "fulfillment_cost_eur": float(row["fulfillment_cost_eur"]),
            },
        )

    with PRICE_TEST_INPUT.open(encoding="utf-8", newline="") as source:
        price_test_rows = list(csv.DictReader(source))
    acceptance_by_price: dict[float, list[float]] = defaultdict(list)
    for row in price_test_rows:
        acceptance_by_price[float(row["price_eur"])].append(
            float(row["estimated_acceptance_pct_of_survey"])
        )

    with MARKETING_FUNNEL_INPUT.open(encoding="utf-8", newline="") as source:
        funnel_rows = list(csv.DictReader(source))
    total_acquired = sum(float(row["conversions_customers_acquired"]) for row in funnel_rows)
    weighted_ltv = sum(
        float(row["ltv_estimate_eur"]) * float(row["conversions_customers_acquired"])
        for row in funnel_rows
    ) / total_acquired

    with CUSTOMER_INPUT.open(encoding="utf-8", newline="") as source:
        customer_rows = list(csv.DictReader(source))
    average_monthly_frequency = mean(
        float(row["purchase_frequency_per_month"]) for row in customer_rows
    )

    with (DATA_DIR / "cost_breakdown.csv").open(encoding="utf-8", newline="") as source:
        cost_rows = list(csv.DictReader(source))
    cogs = float(
        next(
            row["cost_per_unit_eur"]
            for row in cost_rows
            if row["cost_component"] == "TOTAL COGS per unit (330ml can)"
        )
    )
    home_market_kpi = next(
        row["cost_component"] for row in cost_rows if row["cost_component"].startswith("[KPI")
    )
    net_price_match = re.search(r"net price EUR([0-9.]+)", home_market_kpi)
    if net_price_match is None:
        raise ValueError("Could not derive the home-market net price from cost_breakdown.csv")
    home_market_net_price = float(net_price_match.group(1))
    # ltv_estimate_eur has no stated basis in the source export. We calibrate
    # lifetime as net revenue, then calculate scenario LTV from contribution.
    customer_lifetime_months = weighted_ltv / (
        home_market_net_price * average_monthly_frequency
    )

    assumptions = {
        "cogs_per_unit_eur": cogs,
        "channel_economics": channel_economics,
        "acceptance_curve": [
            {
                "price_eur": price,
                "acceptance_pct": mean(acceptances),
            }
            for price, acceptances in sorted(acceptance_by_price.items())
        ],
        "observed_weighted_ltv_eur": weighted_ltv,
        "observed_ltv_basis": "net_revenue_assumption",
        "home_market_net_price_eur": home_market_net_price,
        "average_monthly_frequency": average_monthly_frequency,
        "customer_lifetime_months": customer_lifetime_months,
        "target_ltv_cac_ratio": 3,
    }
    with SIMULATOR_ASSUMPTIONS_OUTPUT.open("w", encoding="utf-8") as destination:
        json.dump(assumptions, destination, indent=2)
        destination.write("\n")


def write_city_prioritisation() -> None:
    """Join city aggregates to Exhibit 1; keep segment diagnostics separate."""
    year = 2026
    with (DATA_DIR / "market_context.csv").open(encoding="utf-8", newline="") as source:
        market_rows = [row for row in csv.DictReader(source) if int(row["year"]) == year]
    national_market = sum(
        float(row["value"]) for row in market_rows
        if row["dimension_type"] == "subcategory" and row["metric"] == "market_size_eur"
    )
    regional = defaultdict(dict)
    for row in market_rows:
        if row["dimension_type"] == "region":
            if row["metric"] in regional[row["name"]]:
                raise ValueError(f"Duplicate regional metric: {row['name']} / {row['metric']}")
            regional[row["name"]][row["metric"]] = float(row["value"])
    if national_market <= 0 or abs(sum(
        row["population_share_of_market"] for row in regional.values()
    ) - 1) > 1e-9:
        raise ValueError("Invalid national market or regional shares")
    with CITY_OUTPUT.open(encoding="utf-8", newline="") as source:
        city_rows = list(csv.DictReader(source))
    if set(regional) != {row["city"] for row in city_rows}:
        raise ValueError("City aggregates and regional market data must match")
    cities = []
    for row in city_rows:
        region = regional[row["city"]]
        count = int(row["respondent_count"])
        wellness_count = int(row["wellness_respondent_count"])
        cities.append({
            "city": row["city"],
            "respondentCount": count,
            "reliability": row["sample_reliability"],
            "purchaseIntent": float(row["avg_lumen_purchase_intent_1_10"]),
            "wellnessRespondentCount": wellness_count,
            "wellnessDensity": wellness_count / count,
            "marketSizeEur": national_market * region["population_share_of_market"],
            "growth": region["regional_cagr"],
        })
    with CUSTOMER_OUTPUT.open(encoding="utf-8", newline="") as source:
        diagnostics = [{
            "city": row["city"], "segment": row["segment"],
            "respondentCount": int(row["respondent_count"]),
            "reliability": row["sample_reliability"],
            "purchaseIntent": float(row["avg_lumen_purchase_intent_1_10"]),
        } for row in csv.DictReader(source)]
    with CITY_PRIORITISATION_OUTPUT.open("w", encoding="utf-8") as destination:
        json.dump({
            "year": year, "nationalMarketEur": national_market,
            "sources": ["market_context.csv (Exhibit 1, illustrative regional assumptions)",
                        "customer_city_aggregates.csv", "customer_segment_city_aggregates.csv"],
            "wellnessProxy": "Urban Wellness Professionals / all respondents in each city",
            "cities": cities, "segmentDiagnostics": diagnostics,
        }, destination, indent=2)
        destination.write("\n")


def write_launch_window() -> None:
    """Preserve Exhibit 12's index scale and export validated monthly context."""
    with (DATA_DIR / "seasonality_and_weather.csv").open(encoding="utf-8", newline="") as source:
        months = sorted([{
            "month": int(row["month"]),
            "demandIndex": float(row["seasonality_index_100_avg"]),
            "temperatureC": float(row["avg_temp_germany_celsius"]),
        } for row in csv.DictReader(source)], key=lambda row: row["month"])
    if [row["month"] for row in months] != list(range(1, 13)):
        raise ValueError("Seasonality requires exactly one row for each month, January–December")
    if any(not math.isfinite(row["demandIndex"]) or row["demandIndex"] <= 0
           or not math.isfinite(row["temperatureC"]) for row in months):
        raise ValueError("Seasonality requires positive finite demand and finite temperature")
    with LAUNCH_WINDOW_OUTPUT.open("w", encoding="utf-8") as destination:
        json.dump({
            "source": "seasonality_and_weather.csv (Exhibit 12)",
            "indexBaseline": 100,
            "demandTestThreshold": 110,
            "months": months,
        }, destination, indent=2)
        destination.write("\n")


def write_price_positioning() -> None:
    """Keep awareness counts within each segment; never pool different segments."""
    brands = [
        ("PulsUp", "aware_pulsup"), ("Mate Libre", "aware_matelibre"),
        ("VoltFit", "aware_voltfit"), ("Root & Rise", "aware_rootandrise"),
    ]
    segment_names = ["Urban Wellness Professionals", "Students & Budget-Conscious",
                     "Fitness & Gym-Goers", "On-the-go Commuters"]
    with CUSTOMER_INPUT.open(encoding="utf-8", newline="") as source:
        groups = defaultdict(list)
        for row in csv.DictReader(source):
            if any(row[field].strip().lower() not in {"0", "1", "true", "false", "yes", "no"}
                   for _, field in brands):
                raise ValueError("Missing or invalid segment awareness response")
            groups[row["segment"]].append(row)
    if set(groups) != set(segment_names):
        raise ValueError("Expected exactly the four survey segments")
    segments = [{
        "name": name, "respondentCount": len(groups[name]),
        "awareness": [{
            "brand": brand,
            "awareCount": sum(is_true(row[field]) for row in groups[name]),
            "awarenessPct": 100 * sum(is_true(row[field]) for row in groups[name]) / len(groups[name]),
        } for brand, field in brands],
    } for name in segment_names]
    prices = []
    seen = set()
    with (DATA_DIR / "competitor_prices_by_channel.csv").open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            if row["format"] != "Single can (330ml)":
                continue
            key = (row["competitor"], row["channel"])
            price = float(row["price_eur"])
            if key in seen or key[0] not in dict(brands) or key[1] not in CHANNELS or not math.isfinite(price) or price <= 0:
                raise ValueError("Invalid or duplicate competitor single-can price")
            seen.add(key)
            prices.append({"brand": key[0], "channel": key[1], "priceEur": price})
    if any(not any(row["brand"] == brand for row in prices) for brand, _ in brands):
        raise ValueError("Missing competitor price evidence")
    with PRICE_POSITIONING_OUTPUT.open("w", encoding="utf-8") as destination:
        json.dump({"brands": [brand for brand, _ in brands], "channels": list(CHANNELS),
                   "format": "Single can (330ml)", "segments": segments, "prices": prices}, destination, indent=2)
        destination.write("\n")


def write_strategy_evidence() -> None:
    """Export segment means and counts from the two separate synthetic surveys."""
    with CUSTOMER_INPUT.open(encoding="utf-8", newline="") as source:
        customers = list(csv.DictReader(source))
    with (DATA_DIR / "price_sensitivity_survey.csv").open(encoding="utf-8", newline="") as source:
        prices = list(csv.DictReader(source))
    segments = []
    for name in sorted({row["segment"] for row in customers}):
        group = [row for row in customers if row["segment"] == name]
        thresholds = [float(row["too_expensive_eur"]) for row in prices if row["segment"] == name]
        if not thresholds or any(not math.isfinite(value) or value <= 0 for value in thresholds):
            raise ValueError(f"Missing or invalid price thresholds for {name}")
        segments.append({
            "name": name,
            "respondentCount": len(group),
            "purchaseIntent": mean(float(row["lumen_purchase_intent_1_10"]) for row in group),
            "monthlySpendEur": mean(float(row["monthly_beverage_spend_eur"]) for row in group),
            "priceSensitivity": mean(float(row["price_sensitivity_1_10"]) for row in group),
            "priceRespondentCount": len(thresholds),
            "tooExpensiveEur": mean(thresholds),
        })
    with STRATEGY_EVIDENCE_OUTPUT.open("w", encoding="utf-8") as destination:
        json.dump({
            "sources": ["customer_survey.csv (Exhibit 4, synthetic)",
                        "price_sensitivity_survey.csv (Exhibit 10, separate synthetic sample)"],
            "respondentCount": len(customers),
            "groceryRespondentCount": sum(row["preferred_channel"] == "Retail/Grocery" for row in customers),
            "channels": [{"name": channel, "respondentCount": sum(row["preferred_channel"] == channel for row in customers)}
                         for channel in CHANNELS],
            "segments": segments,
        }, destination, indent=2)
        destination.write("\n")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    customer_rows = aggregate_customer_survey()
    sales_rows, unique_sales_rows = deduplicate_sales()
    write_simulator_assumptions()
    write_city_prioritisation()
    write_launch_window()
    write_price_positioning()
    write_strategy_evidence()
    print(
        f"Aggregated {customer_rows} customer responses into "
        f"{CUSTOMER_OUTPUT.name} and {CITY_OUTPUT.name}."
    )
    print(
        f"Removed {sales_rows - unique_sales_rows} exact duplicate sales rows; "
        f"wrote {unique_sales_rows} rows to {SALES_OUTPUT.name}."
    )
    print(f"Wrote aggregate simulator assumptions to {SIMULATOR_ASSUMPTIONS_OUTPUT.name}.")
    print(f"Wrote city ranking inputs and separate diagnostics to {CITY_PRIORITISATION_OUTPUT.name}.")
    print(f"Wrote monthly demand and weather context to {LAUNCH_WINDOW_OUTPUT.name}.")
    print(f"Wrote separate segment awareness and comparable prices to {PRICE_POSITIONING_OUTPUT.name}.")
    print(f"Wrote aggregate recommendation evidence to {STRATEGY_EVIDENCE_OUTPUT.name}.")


if __name__ == "__main__":
    main()
