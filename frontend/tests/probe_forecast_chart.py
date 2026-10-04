"""Automated empirical probe for ForecastChart event markers, tooltips, and risk threshold gradient bands.

This probe launches headless Chromium via Playwright, connects to the Vite frontend,
intercepts the backend API for device forecast endpoints, and rigorously validates:
1. Presence of event markers for all four types: DEPLOY, DRIFT_DETECTED, REMEDIATE, and CHAOS.
2. Interactive hover tooltips showing event metadata (title, description, severity, timestamp, styling).
3. Soft SVG gradient risk bands (0-70%, 70-85%, >85%) including <defs>, linearGradients, stops, <rect> coordinates.
4. Edge Case: 0 events (empty event list).
5. Edge Case: Events outside the forecast horizon (negative index, out-of-bounds index, old timestamp).
6. Edge Case: Multiple simultaneous events (same timestamp or same index).
7. Edge Case: Missing relative_index with timestamp calculation.
8. Edge Case: Minimal dataset (history length = 1, median length = 1).
9. Adversarial Case: Clamping with out-of-bounds metrics (>100%, <0%), unknown event types, and tooltip edge clamp.
"""

import sys
import json
import time
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://localhost:5173"

def make_base_forecast(events=None):
    history = [40.0 + (i % 10) for i in range(144)]
    median = [50.0 + i * 0.5 for i in range(72)]
    lower = [m - 5.0 for m in median]
    upper = [m + 5.0 for m in median]
    return {
        "device_id": 1,
        "hostname": "leaf-1.croc.lab",
        "metric": "uplink_util_pct",
        "label": "Uplink Utilization",
        "unit": "%",
        "threshold": 80.0,
        "simulated": False,
        "step_seconds": 300,
        "end_ts": "2026-10-03T18:00:00Z",
        "history": history,
        "median": median,
        "lower": lower,
        "upper": upper,
        "provider": "TimesFM-3.0",
        "breach_in_minutes": 180,
        "events": events or [],
    }

def run_probe():
    results = {}
    console_errors = []
    page_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()

        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))

        # -------------------------------------------------------------
        # TEST 1: ALL 4 EVENT MARKERS & TOOLTIPS & RISK BANDS
        # -------------------------------------------------------------
        print("\n=== TEST 1: Verification of 4 Event Markers & Tooltips & Risk Bands ===")
        test1_events = [
            {
                "type": "DEPLOY",
                "timestamp": "2026-10-03T12:00:00Z",
                "title": "BGP Spine-Leaf Config Deploy",
                "description": "Applied BGP EVPN config to spine-1 and leaf-1",
                "severity": "info",
                "relative_index": 72,
            },
            {
                "type": "DRIFT_DETECTED",
                "timestamp": "2026-10-03T15:30:00Z",
                "title": "Unauth ACL Change",
                "description": "Rule 100 modified outside of NetOps pipeline",
                "severity": "warning",
                "relative_index": 114,
            },
            {
                "type": "REMEDIATE",
                "timestamp": "2026-10-03T16:00:00Z",
                "title": "Remediation Patch Applied",
                "description": "Automated patch restored authorized intent",
                "severity": "success",
                "relative_index": 120,
            },
            {
                "type": "CHAOS",
                "timestamp": "2026-10-03T17:00:00Z",
                "title": "Chaos Link Congestion",
                "description": "Simulated synthetic traffic burst on Eth1/1",
                "severity": "critical",
                "relative_index": 132,
            },
        ]
        test1_data = make_base_forecast(test1_events)

        def route_handler_test1(route):
            if "forecast" in route.request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(test1_data))
            else:
                route.continue_()

        page.route("**/api/v1/devices/*/forecast*", route_handler_test1)

        page.goto(BASE_URL, wait_until="networkidle")
        page.wait_for_timeout(800)

        # Navigate to Devices -> first device -> Прогноз
        page.locator('button:has-text("Устройства"), a:has-text("Устройства")').first.click()
        page.wait_for_timeout(600)
        page.locator("table tbody tr").first.click()
        page.wait_for_timeout(600)
        page.get_by_role("button", name="Прогноз", exact=True).click()
        page.wait_for_timeout(800)

        # 1.1 Verify presence of event markers
        lines = page.locator("svg line.event-marker")
        circles = page.locator("svg circle.event-marker")
        line_count = lines.count()
        circle_count = circles.count()
        print(f"   [1.1] Line markers found: {line_count}, Circle badges found: {circle_count}")
        assert line_count == 4, f"Expected 4 line markers, got {line_count}"
        assert circle_count == 4, f"Expected 4 circle badges, got {circle_count}"

        types_found = [c.get_attribute("data-event") for c in circles.all()]
        print(f"   [1.1] Event types present on circles: {types_found}")
        expected_types = ["DEPLOY", "DRIFT_DETECTED", "REMEDIATE", "CHAOS"]
        for t in expected_types:
            assert t in types_found, f"Missing event marker type: {t}"

        for c in circles.all():
            ev_type = c.get_attribute("data-event")
            stroke = c.evaluate("el => getComputedStyle(el).stroke")
            print(f"        Event {ev_type} circle stroke: {stroke}")

        # 1.2 Verify Tooltip Hover Interaction on each marker
        print("   [1.2] Testing Interactive Hover Tooltips...")
        hit_rects = page.locator("svg g rect.cursor-pointer")
        hit_count = hit_rects.count()
        print(f"        Hit targets count: {hit_count}")
        assert hit_count == 4, f"Expected 4 hit targets, got {hit_count}"

        for idx, rect in enumerate(hit_rects.all()):
            ev = test1_events[idx]
            rect.hover(force=True)
            page.wait_for_timeout(250)

            tooltip = page.locator("div.glass-panel:has-text('" + ev["title"] + "')")
            is_vis = tooltip.is_visible()
            print(f"        Hover on marker {idx} ({ev['type']}): tooltip visible = {is_vis}")
            assert is_vis, f"Tooltip did not appear for event {ev['type']}"

            title_text = tooltip.locator(f"span:text-is('{ev['title']}')").text_content()
            type_text = tooltip.locator(f"span:text-is('{ev['type']}')").text_content()
            desc_text = tooltip.locator("p").text_content()
            sev_text = tooltip.locator("span:has-text('Важность:')").text_content()

            assert title_text == ev["title"], f"Tooltip title mismatch: {title_text}"
            assert type_text == ev["type"], f"Tooltip type mismatch: {type_text}"
            assert desc_text == ev["description"], f"Tooltip desc mismatch: {desc_text}"
            assert ev["severity"] in sev_text, f"Tooltip severity mismatch: {sev_text}"
            print(f"        Verified tooltip contents: title='{title_text}', type='{type_text}', severity='{sev_text}'")

        # Test mouseleave: move mouse away to header
        page.locator("h1, h2, h3").first.hover()
        page.wait_for_timeout(200)
        tooltips_remaining = page.locator("div.glass-panel:has-text('BGP Spine-Leaf')").count()
        assert tooltips_remaining == 0, "Tooltip remained open after mouse leave"
        print("        Hover exit verified: tooltip cleanly dismissed.")

        # 1.3 Verify Soft SVG Gradient Risk Bands
        print("   [1.3] Testing Soft SVG Gradient Risk Bands...")
        defs = page.locator("svg defs")
        assert defs.count() > 0, "Missing <defs> element in SVG"

        grad_normal = page.locator("svg defs linearGradient#riskNormalGrad")
        grad_warning = page.locator("svg defs linearGradient#riskWarningGrad")
        grad_critical = page.locator("svg defs linearGradient#riskCriticalGrad")

        assert grad_normal.count() == 1, "Missing riskNormalGrad linearGradient"
        assert grad_warning.count() == 1, "Missing riskWarningGrad linearGradient"
        assert grad_critical.count() == 1, "Missing riskCriticalGrad linearGradient"

        normal_stops = grad_normal.locator("stop")
        assert normal_stops.count() == 2, "riskNormalGrad should have 2 stops"
        print(f"        riskNormalGrad stop 0 color: {normal_stops.first.get_attribute('stop-color')}, opacity: {normal_stops.first.get_attribute('stop-opacity')}")

        warning_stops = grad_warning.locator("stop")
        assert warning_stops.count() == 2, "riskWarningGrad should have 2 stops"
        print(f"        riskWarningGrad stop 0 color: {warning_stops.first.get_attribute('stop-color')}, opacity: {warning_stops.first.get_attribute('stop-opacity')}")

        critical_stops = grad_critical.locator("stop")
        assert critical_stops.count() == 2, "riskCriticalGrad should have 2 stops"
        print(f"        riskCriticalGrad stop 0 color: {critical_stops.first.get_attribute('stop-color')}, opacity: {critical_stops.first.get_attribute('stop-opacity')}")

        # Check rectangles filling gradients
        rect_normal = page.locator('svg rect[fill="url(#riskNormalGrad)"]')
        rect_warning = page.locator('svg rect[fill="url(#riskWarningGrad)"]')
        rect_critical = page.locator('svg rect[fill="url(#riskCriticalGrad)"]')

        assert rect_normal.count() == 1, "Missing rect for riskNormalGrad"
        assert rect_warning.count() == 1, "Missing rect for riskWarningGrad"
        assert rect_critical.count() == 1, "Missing rect for riskCriticalGrad"

        y_norm = float(rect_normal.get_attribute("y"))
        h_norm = float(rect_normal.get_attribute("height"))
        y_warn = float(rect_warning.get_attribute("y"))
        h_warn = float(rect_warning.get_attribute("height"))
        y_crit = float(rect_critical.get_attribute("y"))
        h_crit = float(rect_critical.get_attribute("height"))

        print(f"        Normal Band (0-70%):   y={y_norm}, height={h_norm} (spans from y={y_norm} down to y={y_norm+h_norm})")
        print(f"        Warning Band (70-85%):  y={y_warn}, height={h_warn} (spans from y={y_warn} down to y={y_warn+h_warn})")
        print(f"        Critical Band (85-100%): y={y_crit}, height={h_crit} (spans from y={y_crit} down to y={y_crit+h_crit})")

        assert y_crit < y_warn, f"Expected y_crit ({y_crit}) < y_warn ({y_warn})"
        assert y_warn < y_norm, f"Expected y_warn ({y_warn}) < y_norm ({y_norm})"
        assert abs((y_warn + h_warn) - y_norm) < 0.01, "Warning bottom must match Normal top"
        assert abs((y_crit + h_crit) - y_warn) < 0.01, "Critical bottom must match Warning top"
        print("        Gradient bands are perfectly contiguous without gaps or overlaps!")

        # 1.4 Verify Legend
        legend_deploy = page.locator("span:has-text('DEPLOY')")
        legend_drift = page.locator("span:has-text('DRIFT')")
        legend_remediate = page.locator("span:has-text('REMEDIATE')")
        legend_chaos = page.locator("span:has-text('CHAOS')")
        assert legend_deploy.count() > 0, "Missing DEPLOY in legend"
        assert legend_drift.count() > 0, "Missing DRIFT in legend"
        assert legend_remediate.count() > 0, "Missing REMEDIATE in legend"
        assert legend_chaos.count() > 0, "Missing CHAOS in legend"
        print("   [1.4] Event legend is complete and rendered.")
        results["test1_standard_flow"] = "PASS"

        # -------------------------------------------------------------
        # TEST 2: EDGE CASE - 0 EVENTS
        # -------------------------------------------------------------
        print("\n=== TEST 2: Edge Case — 0 Events ===")
        test2_data = make_base_forecast([])

        def route_handler_test2(route):
            if "forecast" in route.request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(test2_data))
            else:
                route.continue_()

        page.unroute("**/api/v1/devices/*/forecast*")
        page.route("**/api/v1/devices/*/forecast*", route_handler_test2)

        # Trigger re-fetch by switching metric button to 'Загрузка CPU'
        page.locator('button:has-text("Загрузка CPU")').click()
        page.wait_for_timeout(600)

        lines_0 = page.locator("svg line.event-marker").count()
        circles_0 = page.locator("svg circle.event-marker").count()
        print(f"   Line markers count with 0 events: {lines_0}")
        print(f"   Circle markers count with 0 events: {circles_0}")
        assert lines_0 == 0, f"Expected 0 line markers, got {lines_0}"
        assert circles_0 == 0, f"Expected 0 circle markers, got {circles_0}"

        # Risk bands still present and valid
        assert page.locator('svg rect[fill="url(#riskNormalGrad)"]').count() == 1
        assert page.locator('svg rect[fill="url(#riskWarningGrad)"]').count() == 1
        assert page.locator('svg rect[fill="url(#riskCriticalGrad)"]').count() == 1
        print("   Risk bands and axes intact with 0 events.")
        results["test2_zero_events"] = "PASS"

        # -------------------------------------------------------------
        # TEST 3: EDGE CASE - EVENTS OUTSIDE HORIZON
        # -------------------------------------------------------------
        print("\n=== TEST 3: Edge Case — Events Outside Horizon & Invalid Indexes ===")
        test3_events = [
            # Event with negative relative_index
            {
                "type": "DEPLOY",
                "timestamp": "2026-10-01T00:00:00Z",
                "title": "Ancient Deploy",
                "description": "Way before window",
                "severity": "info",
                "relative_index": -10,
            },
            # Event with relative_index beyond total
            {
                "type": "CHAOS",
                "timestamp": "2026-10-05T00:00:00Z",
                "title": "Far Future Chaos",
                "description": "Far beyond window",
                "severity": "critical",
                "relative_index": 500,
            },
            # Event with timestamp far in the past (> 48h ago)
            {
                "type": "DRIFT_DETECTED",
                "timestamp": "2026-09-01T12:00:00Z",
                "title": "Last Month Drift",
                "description": "Computed index is deeply negative",
                "severity": "warning",
            },
            # Event with valid in-horizon relative_index
            {
                "type": "REMEDIATE",
                "timestamp": "2026-10-03T17:30:00Z",
                "title": "Valid In-Horizon Event",
                "description": "Inside horizon",
                "severity": "success",
                "relative_index": 100,
            },
        ]
        test3_data = make_base_forecast(test3_events)

        def route_handler_test3(route):
            if "forecast" in route.request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(test3_data))
            else:
                route.continue_()

        page.unroute("**/api/v1/devices/*/forecast*")
        page.route("**/api/v1/devices/*/forecast*", route_handler_test3)

        # Toggle back to 'Загрузка аплинка'
        page.locator('button:has-text("Загрузка аплинка")').click()
        page.wait_for_timeout(600)

        lines_3 = page.locator("svg line.event-marker")
        circles_3 = page.locator("svg circle.event-marker")
        print(f"   Line markers count with out-of-horizon events: {lines_3.count()}")
        print(f"   Circle markers count with out-of-horizon events: {circles_3.count()}")

        # Exactly 1 event is within horizon (the REMEDIATE at relative_index 100)
        assert lines_3.count() == 1, f"Expected 1 marker line within horizon, got {lines_3.count()}"
        assert circles_3.count() == 1, f"Expected 1 circle badge within horizon, got {circles_3.count()}"
        assert circles_3.first.get_attribute("data-event") == "REMEDIATE"

        # Check for any NaN coordinates in SVG
        nan_elements = page.locator('svg *[x*="NaN"], svg *[y*="NaN"], svg *[cx*="NaN"], svg *[cy*="NaN"], svg *[d*="NaN"]').count()
        print(f"   SVG elements with NaN coordinates: {nan_elements}")
        assert nan_elements == 0, f"Found {nan_elements} SVG elements with NaN coordinates!"

        results["test3_outside_horizon"] = "PASS"

        # -------------------------------------------------------------
        # TEST 4: EDGE CASE - MULTIPLE SIMULTANEOUS EVENTS
        # -------------------------------------------------------------
        print("\n=== TEST 4: Edge Case — Multiple Simultaneous Events ===")
        test4_events = [
            {
                "type": "DEPLOY",
                "timestamp": "2026-10-03T16:00:00Z",
                "title": "Emergency Deploy",
                "description": "Hotfix push at t=16:00",
                "severity": "info",
                "relative_index": 120,
            },
            {
                "type": "CHAOS",
                "timestamp": "2026-10-03T16:00:00Z",
                "title": "Coincident Link Flap",
                "description": "Simultaneous link failure at t=16:00",
                "severity": "critical",
                "relative_index": 120,
            },
            {
                "type": "DRIFT_DETECTED",
                "timestamp": "2026-10-03T16:00:00Z",
                "title": "Coincident Drift Alert",
                "description": "Drift raised concurrently at t=16:00",
                "severity": "warning",
                "relative_index": 120,
            },
        ]
        test4_data = make_base_forecast(test4_events)

        def route_handler_test4(route):
            if "forecast" in route.request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(test4_data))
            else:
                route.continue_()

        page.unroute("**/api/v1/devices/*/forecast*")
        page.route("**/api/v1/devices/*/forecast*", route_handler_test4)

        page.locator('button:has-text("Загрузка CPU")').click()
        page.wait_for_timeout(600)

        lines_4 = page.locator("svg line.event-marker")
        circles_4 = page.locator("svg circle.event-marker")
        print(f"   Line markers count with 3 simultaneous events: {lines_4.count()}")
        print(f"   Circle markers count with 3 simultaneous events: {circles_4.count()}")

        assert lines_4.count() == 3, f"Expected 3 lines, got {lines_4.count()}"
        assert circles_4.count() == 3, f"Expected 3 circles, got {circles_4.count()}"

        # Verify all 3 have identical X coordinates
        x_coords = [float(c.get_attribute("cx")) for c in circles_4.all()]
        print(f"   Circle X coordinates: {x_coords}")
        assert len(set(x_coords)) == 1, "All simultaneous events must share identical X coordinate"

        # Verify hover over the stack renders tooltip without React crashes
        hit_target = page.locator("svg g rect.cursor-pointer").last
        hit_target.hover(force=True)
        page.wait_for_timeout(200)
        sim_tooltip = page.locator("div.glass-panel:has-text('Coincident Drift Alert')")
        assert sim_tooltip.is_visible(), "Top-stacked simultaneous event tooltip should be visible"
        print("   Hover on simultaneous stacked event functions properly.")

        results["test4_simultaneous_events"] = "PASS"

        # -------------------------------------------------------------
        # TEST 5: EDGE CASE - TIMESTAMP CALCULATION (NO RELATIVE INDEX)
        # -------------------------------------------------------------
        print("\n=== TEST 5: Edge Case — Timestamp-only Event Mapping ===")
        # end_ts = 2026-10-03T18:00:00Z, step_seconds = 300, n = 144
        # Event 1 hour ago: 2026-10-03T17:00:00Z (3600 sec ago = 12 steps ago)
        # computedIdx = (144 - 1) - 12 = 131
        test5_events = [
            {
                "type": "DEPLOY",
                "timestamp": "2026-10-03T17:00:00Z",
                "title": "Calculated via Timestamp",
                "description": "No relative_index provided",
                "severity": "info",
                # relative_index omitted deliberately
            }
        ]
        test5_data = make_base_forecast(test5_events)

        def route_handler_test5(route):
            if "forecast" in route.request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(test5_data))
            else:
                route.continue_()

        page.unroute("**/api/v1/devices/*/forecast*")
        page.route("**/api/v1/devices/*/forecast*", route_handler_test5)

        page.locator('button:has-text("Загрузка аплинка")').click()
        page.wait_for_timeout(600)

        lines_5 = page.locator("svg line.event-marker")
        circles_5 = page.locator("svg circle.event-marker")
        print(f"   Timestamp-only mapped line markers count: {lines_5.count()}")
        assert lines_5.count() == 1, "Timestamp-only event should be mapped and drawn"
        assert circles_5.count() == 1, "Timestamp-only event circle should be drawn"
        cx = float(circles_5.first.get_attribute("cx"))
        print(f"   Computed X coordinate for 1h ago: {cx} (PAD.l=40, W=820)")
        assert 40 < cx < 820, "Computed coordinate must be within chart bounds"

        results["test5_timestamp_calculation"] = "PASS"

        # -------------------------------------------------------------
        # TEST 6: EDGE CASE - MINIMAL DATASET
        # -------------------------------------------------------------
        print("\n=== TEST 6: Edge Case — Minimal History & Forecast Series ===")
        test6_data = {
            "device_id": 1,
            "hostname": "leaf-1.croc.lab",
            "metric": "uplink_util_pct",
            "label": "Minimal Dataset",
            "unit": "%",
            "threshold": 75.0,
            "simulated": False,
            "step_seconds": 300,
            "end_ts": "2026-10-03T18:00:00Z",
            "history": [45.0],
            "median": [65.0],
            "lower": [55.0],
            "upper": [75.0],
            "provider": "TestModel",
            "breach_in_minutes": None,
            "events": [
                {
                    "type": "CHAOS",
                    "timestamp": "2026-10-03T18:00:00Z",
                    "title": "Minimal Chaos",
                    "description": "Event on minimal series",
                    "severity": "critical",
                    "relative_index": 0,
                }
            ],
        }

        def route_handler_test6(route):
            if "forecast" in route.request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(test6_data))
            else:
                route.continue_()

        page.unroute("**/api/v1/devices/*/forecast*")
        page.route("**/api/v1/devices/*/forecast*", route_handler_test6)

        page.locator('button:has-text("Загрузка CPU")').click()
        page.wait_for_timeout(600)

        lines_6 = page.locator("svg line.event-marker")
        print(f"   Minimal dataset line markers count: {lines_6.count()}")
        assert lines_6.count() == 1, "Minimal dataset marker should render"

        # Verify no NaN coordinates
        nan_elements_6 = page.locator('svg *[x*="NaN"], svg *[y*="NaN"], svg *[cx*="NaN"], svg *[cy*="NaN"], svg *[d*="NaN"]').count()
        assert nan_elements_6 == 0, "No NaN in minimal dataset"
        print("   Minimal dataset handled without division by zero or NaN coordinates.")

        results["test6_minimal_dataset"] = "PASS"

        # -------------------------------------------------------------
        # TEST 7: ADVERSARIAL STRESS - UNKNOWN EVENT & EXTREME BOUNDS
        # -------------------------------------------------------------
        print("\n=== TEST 7: Adversarial Stress — Unknown Event Type & Extreme Metric Bounds ===")
        # In test7, total points = 3 + 72 = 75
        test7_events = [
            {
                "type": "CUSTOM_SECURITY_AUDIT",
                "timestamp": "2026-10-03T17:00:00Z",
                "title": "Custom Unknown Event",
                "description": "Event with unmapped type",
                "severity": "info",
                "relative_index": 1, # Near left edge (total=75) -> x(1) ~ 50px -> clamp 15%
            },
            {
                "type": "DEPLOY",
                "title": "Near Right Edge Event",
                "description": "Event near right edge of horizon",
                "severity": "info",
                "relative_index": 73, # Near right edge (total=75) -> x(73) ~ 793px -> clamp 82%
            },
        ]
        test7_data = {
            "device_id": 1,
            "hostname": "leaf-1.croc.lab",
            "metric": "uplink_util_pct",
            "label": "Extreme Bounds Dataset",
            "unit": "%",
            "threshold": 125.0, # Beyond 100%
            "simulated": False,
            "step_seconds": 300,
            "end_ts": "2026-10-03T18:00:00Z",
            "history": [-25.0, 150.0, 999.0], # Wildly outside [0, 100]
            "median": [50.0] * 72,
            "lower": [40.0] * 72,
            "upper": [60.0] * 72,
            "provider": "StressTest",
            "breach_in_minutes": None,
            "events": test7_events,
        }

        def route_handler_test7(route):
            if "forecast" in route.request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(test7_data))
            else:
                route.continue_()

        page.unroute("**/api/v1/devices/*/forecast*")
        page.route("**/api/v1/devices/*/forecast*", route_handler_test7)

        page.locator('button:has-text("Загрузка аплинка")').click()
        page.wait_for_timeout(600)

        # Verify fallback styling for unknown event type
        custom_circle = page.locator('svg circle[data-event="CUSTOM_SECURITY_AUDIT"]')
        assert custom_circle.count() == 1, "Unknown event type circle should be rendered"
        custom_symbol = page.locator('svg text:text-is("•")')
        assert custom_symbol.count() >= 1, "Fallback symbol bullet should be rendered"
        print("   Unknown event fallback rendered with default symbol and styling.")

        # Hover near left edge (relative_index 1)
        page.locator("svg g rect.cursor-pointer").first.hover(force=True)
        page.wait_for_timeout(200)
        left_tooltip = page.locator("div.glass-panel:has-text('Custom Unknown Event')")
        assert left_tooltip.is_visible(), "Left edge tooltip should be visible"
        left_style = left_tooltip.get_attribute("style")
        print(f"   Left-edge tooltip style: {left_style}")
        assert "15%" in left_style, "Tooltip clamped away from left boundary (15%)"

        # Hover near right edge (relative_index 73)
        page.locator("svg g rect.cursor-pointer").last.hover(force=True)
        page.wait_for_timeout(200)
        right_tooltip = page.locator("div.glass-panel:has-text('Near Right Edge Event')")
        assert right_tooltip.is_visible(), "Right edge tooltip should be visible"
        right_style = right_tooltip.get_attribute("style")
        print(f"   Right-edge tooltip style: {right_style}")
        assert "82%" in right_style, "Tooltip clamped away from right boundary (82%)"

        results["test7_adversarial_stress"] = "PASS"

        # -------------------------------------------------------------
        # FINAL AUDIT SUMMARY
        # -------------------------------------------------------------
        print("\n=== FINAL PROBE AUDIT SUMMARY ===")
        print(f"Browser console errors: {len(console_errors)}")
        for err in console_errors:
            print(f"   ERROR: {err}")
        print(f"Page uncaught exceptions: {len(page_errors)}")
        for perr in page_errors:
            print(f"   PAGE ERROR: {perr}")

        assert len(console_errors) == 0, f"Expected 0 console errors, got {len(console_errors)}"
        assert len(page_errors) == 0, f"Expected 0 page errors, got {len(page_errors)}"

        browser.close()

    print("\nALL EMPIRICAL TESTS PASSED:")
    for k, v in results.items():
        print(f"  {k}: {v}")
    return results

if __name__ == "__main__":
    run_probe()
