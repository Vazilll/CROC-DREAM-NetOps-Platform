import os
import asyncio
from playwright.async_api import async_playwright

CHROME_PATH = "/home/tarhes/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"

async def main():
    async with async_playwright() as p:
        if os.path.exists(CHROME_PATH):
            browser = await p.chromium.launch(executable_path=CHROME_PATH, headless=True)
        else:
            browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        console_errors = []
        page_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        print("=== STAGE 1: Load Dashboard with Token ===")
        await page.goto("http://localhost:5173/?token=dev-admin-token")
        await page.wait_for_selector("header")

        print("=== STAGE 2: Test '?' key opens ShortcutsModal ===")
        # Press '?' key on page
        await page.keyboard.press("?")
        await page.wait_for_selector("text=Горячие клавиши и роли платформы", timeout=5000)
        assert await page.is_visible("text=Горячие клавиши и роли платформы"), "Shortcuts modal should be visible"
        print("   Shortcuts modal opened via '?' key: PASS")

        print("=== STAGE 3: Test 'Escape' key closes ShortcutsModal ===")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        assert not await page.is_visible("text=Горячие клавиши и роли платформы"), "Shortcuts modal should be closed by Esc"
        print("   Shortcuts modal closed via Escape: PASS")

        print("=== STAGE 4: Test '?' button in Header opens ShortcutsModal ===")
        shortcuts_btn = page.locator("button[title*='Горячие клавиши']")
        await shortcuts_btn.click()
        await page.wait_for_selector("text=Горячие клавиши и роли платформы", timeout=5000)
        assert await page.is_visible("text=Горячие клавиши и роли платформы"), "Shortcuts modal should open on button click"
        print("   Shortcuts modal opened via Header button: PASS")

        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)

        print("=== STAGE 5: Test DevicePage Passport Export Button ===")
        # Navigate to devices
        await page.click("button:has-text('Устройства')")
        await page.wait_for_selector("text=leaf-1.croc.lab")

        # Open leaf-1
        await page.click("text=leaf-1.croc.lab")
        await page.wait_for_selector("text=Паспорт (MD)")
        assert await page.is_visible("text=Паспорт (MD)"), "Passport export button should be visible on DevicePage"
        print("   DevicePage Passport (MD) export button rendered: PASS")

        # Test clicking export button (handles download trigger)
        async with page.expect_download() as download_info:
            await page.click("text=Паспорт (MD)")
        download = await download_info.value
        filename = download.suggested_filename
        assert "Passport_leaf-1" in filename and filename.endswith(".md"), f"Unexpected download filename: {filename}"
        print(f"   Passport download triggered successfully: {filename}")

        print(f"Console errors: {len(console_errors)}")
        print(f"Page errors: {len(page_errors)}")
        assert len(console_errors) == 0, f"Expected 0 console errors, got {console_errors}"
        assert len(page_errors) == 0, f"Expected 0 page errors, got {page_errors}"

        print("=== ALL NEW UX PROBES PASSED SUCCESSFULLY ===")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
