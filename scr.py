# auto_login_and_scrape.py
from playwright.sync_api import sync_playwright
import json, time, csv

LOGIN_URL = "https://business.bosta.co/signin"  # عدّل لو الرابط مختلف
TARGET_URL = "https://business.bosta.co/create-order"
STORAGE_FILE = "bosta_storage.json"
OUTPUT_JSON = "bosta_regions.json"

EMAIL = "deifmo111@gmail.com"
PASSWORD = "1qaz2wsxQQQ@Q"

def login_and_save_storage():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)  # False علشان تشوف العملية
        page = browser.new_page()
        page.goto(LOGIN_URL, wait_until="networkidle", timeout=30000)

        # انتظر لحد ما input email يظهر (جرب سيلكتورات متعددة)
        email_selectors = [
            "input[name='email']",
            "input[type='email']",
            "input#email",
            "input.email"
        ]
        password_selectors = [
            "input[name='password']",
            "input[type='password']",
            "input#password"
        ]
        
        # Find and fill email
        email_filled = False
        for selector in email_selectors:
            try:
                page.wait_for_selector(selector, timeout=5000)
                page.fill(selector, EMAIL)
                email_filled = True
                print(f"Email filled using: {selector}")
                break
            except:
                continue
        
        if not email_filled:
            print("ERROR: Could not find email input field")
            page.screenshot(path="debug_email.png")
            browser.close()
            return
        
        # Find and fill password
        password_filled = False
        for selector in password_selectors:
            try:
                page.wait_for_selector(selector, timeout=5000)
                page.fill(selector, PASSWORD)
                password_filled = True
                print(f"Password filled using: {selector}")
                break
            except:
                continue
        
        if not password_filled:
            print("ERROR: Could not find password input field")
            page.screenshot(path="debug_password.png")
            browser.close()
            return
        
        # Click submit button
        page.click("button[type='submit']")

        # انتظر لحد ما الصفحة تثبت انو تسجيل الدخول نجح (مثال: وجود عنصر في الهيدر)
        page.wait_for_load_state("networkidle", timeout=15000)
        # أو انتظار عنصر يدل على نجاح الدخول:
        # page.wait_for_selector("text=لوحة التحكم", timeout=15000)

        # لو فيه 2FA أو captcha هيفشل هنا — في الحالة دي استخدم الخيار ب (يدوي)
        page.context.storage_state(path=STORAGE_FILE)
        print("Saved storage state to", STORAGE_FILE)
        browser.close()

def use_saved_and_scrape():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)  # False for debugging - can see what's happening
        context = browser.new_context(storage_state=STORAGE_FILE)
        page = context.new_page()
        page.goto(TARGET_URL, wait_until="networkidle", timeout=30000)
        
        print("Page loaded successfully!")
        time.sleep(2)
        
        # Take screenshot before trying to open modal
        page.screenshot(path="before_modal.png")
        print("Screenshot saved: before_modal.png")
        
        # First, we need to click on the area/region input to open the modal
        # Look for input fields that might open the regions modal
        try:
            # Try to find and click on the city/area input field
            area_inputs = [
                "input[placeholder*='المدينة']",
                "input[placeholder*='المنطقة']",
                "input[placeholder*='المحافظة']",
                ".ant-select-selector input",
                "input[data-testid*='city']",
                "input[data-testid*='area']"
            ]
            
            clicked = False
            for selector in area_inputs:
                try:
                    page.wait_for_selector(selector, timeout=3000)
                    page.click(selector)
                    clicked = True
                    print(f"Clicked area input: {selector}")
                    break
                except:
                    continue
            
            if not clicked:
                print("Could not find area input. Taking screenshot...")
                page.screenshot(path="error_input.png")
                print("\nPlease inspect the page and press Enter to continue...")
                input()
                
        except Exception as e:
            print(f"Error clicking input: {e}")
        
        time.sleep(1)
        
        # Wait for the modal with accordion to be visible
        try:
            page.wait_for_selector(".ant-modal-body .ant-collapse", timeout=10000)
            print("Modal opened successfully!")
        except:
            print("ERROR: Could not find accordion. Taking screenshot...")
            page.screenshot(path="error_accordion.png")
            print("Please inspect the page. Press Enter to close...")
            input()
            browser.close()
            return
        
        # Find all governorate items (collapsible items)
        governorate_items = page.locator(".ant-collapse-item")
        total_governorates = governorate_items.count()
        print(f"Found {total_governorates} governorates")
        
        all_areas = []
        
        # Loop through each governorate and expand it
        for i in range(total_governorates):
            try:
                item = governorate_items.nth(i)
                
                # Get governorate name
                governorate_name = item.locator(".ant-collapse-header-text span").first.inner_text().strip()
                print(f"\nProcessing: {governorate_name} ({i+1}/{total_governorates})")
                
                # Check if already expanded
                is_expanded = "ant-collapse-item-active" in item.get_attribute("class")
                
                if not is_expanded:
                    # Click to expand the governorate
                    item.locator(".ant-collapse-header").click()
                    time.sleep(0.5)  # Wait for content to load
                
                # Get all areas under this governorate
                area_items = item.locator(".br-city-area__area")
                area_count = area_items.count()
                print(f"  Found {area_count} areas")
                
                for j in range(area_count):
                    area_item = area_items.nth(j)
                    area_text = area_item.locator(".br-city-area__area-text span").first.inner_text().strip()
                    if area_text:
                        all_areas.append({
                            "governorate": governorate_name,
                            "area": area_text
                        })
                
            except Exception as e:
                print(f"  Error processing item {i}: {str(e)}")
                continue
        
        # Save results
        with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
            json.dump(all_areas, f, ensure_ascii=False, indent=2)
        print(f"\n✓ Saved {len(all_areas)} areas to {OUTPUT_JSON}")
        
        print("\nPress Enter to close browser...")
        input()
        browser.close()

if __name__ == "__main__":
    # شغّل login_and_save_storage() مرة واحدة لو ما عندكش storage file
    # بعد ما يعمل حفظ تقدر تشغّل use_saved_and_scrape()
    # login_and_save_storage()  # Uncomment if you need to re-login
    # بعد حفظ ال storage file، شغّل:
    use_saved_and_scrape()
