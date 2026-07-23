#!/usr/bin/env python3
"""
JavBus 女优列表爬取脚本
- 并发抓取多页
- 提取演员名称、主页地址、头像
- 下载头像到 avators/ 目录
- 输出 CSV 到 actresses/ 目录
"""
import re
import os
import csv
import asyncio
import aiohttp
from pathlib import Path
from bs4 import BeautifulSoup

# ============ 配置 ============
BASE_URL = "https://www.javbus.com/actresses/"
OUTPUT_DIR = Path(r"/mnt/e/GitHub/All_in_Ai/MineFilmLibrary/actresses")
AVATAR_DIR = OUTPUT_DIR / "avators"
CSV_PATH = OUTPUT_DIR / "actresses.csv"
PAGE_CONCURRENCY = 5       # 页面抓取并发数
AVATAR_CONCURRENCY = 8     # 头像下载并发数
REQUEST_DELAY = 0.8        # 每次请求间隔（秒）
RETRY_TIMES = 3
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.javbus.com/actresses",
}
COOKIES = {"existmag": "all"}
# =============================


async def fetch_page(session: aiohttp.ClientSession, page_no: int, sem: asyncio.Semaphore):
    """抓取单页 HTML"""
    url = f"{BASE_URL}{page_no}"
    async with sem:
        for attempt in range(RETRY_TIMES):
            try:
                await asyncio.sleep(REQUEST_DELAY)
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=20), allow_redirects=True) as resp:
                    if resp.status != 200:
                        print(f"  [页{page_no}] HTTP {resp.status}, 重试 {attempt+1}")
                        await asyncio.sleep(3)
                        continue
                    html = await resp.text()
                    # 被重定向到验证页
                    if "driver-verify" in html or "Age Verification" in html:
                        print(f"  [页{page_no}] 触发验证, 等待重试")
                        await asyncio.sleep(5)
                        continue
                    return html
            except Exception as e:
                print(f"  [页{page_no}] 错误: {e}, 重试 {attempt+1}")
                await asyncio.sleep(3)
    return None


def parse_actresses(html: str) -> list[dict]:
    """解析页面中的演员列表"""
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for item in soup.select("div.item"):
        link = item.select_one("a.avatar-box")
        img = item.select_one("img")
        if not link or not img:
            continue
        href = link.get("href", "") or ""
        name = img.get("title", "") or ""
        img_src = img.get("src", "") or ""
        if isinstance(img_src, list):
            img_src = img_src[0] if img_src else ""
        if isinstance(name, list):
            name = name[0] if name else ""
        if isinstance(href, list):
            href = href[0] if href else ""
        name = str(name).strip()
        img_src = str(img_src)
        href = str(href)
        if img_src.startswith("/"):
            img_src = "https://www.javbus.com" + img_src
        if href.startswith("/"):
            href = "https://www.javbus.com" + href
        results.append({"name": name, "url": href, "avatar": img_src})
    return results


async def find_last_page(session: aiohttp.ClientSession) -> int:
    """二分查找最后一页"""
    sem = asyncio.Semaphore(1)
    print("  探测上界...")
    # 先测试 page 1
    html = await fetch_page(session, 1, sem)
    if not html or not parse_actresses(html):
        print("  无法访问第1页!")
        return 0

    # 测试几个点确定上界
    lo, hi = 1, 500
    for test in [100, 200, 300, 500, 800, 1000]:
        h = await fetch_page(session, test, sem)
        if h and parse_actresses(h):
            lo = test
        else:
            hi = test
            break

    print(f"  最后一页在 [{lo}, {hi}] 之间, 开始二分...")
    while hi - lo > 1:
        mid = (lo + hi) // 2
        h = await fetch_page(session, mid, sem)
        if h and parse_actresses(h):
            print(f"    页 {mid}: 有数据")
            lo = mid
        else:
            print(f"    页 {mid}: 无数据")
            hi = mid - 1
    # 确认 lo 确实有数据
    return lo


async def download_avatar(session: aiohttp.ClientSession, actress: dict, sem: asyncio.Semaphore):
    """下载头像"""
    avatar_url = actress.get("avatar", "")
    if not avatar_url:
        return ""

    safe_name = re.sub(r'[\\/:*?"<>|]', "_", actress["name"])
    filepath = AVATAR_DIR / f"{safe_name}.jpg"
    if filepath.exists() and filepath.stat().st_size > 1000:
        return str(filepath)

    async with sem:
        for attempt in range(2):
            try:
                async with session.get(avatar_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status == 200:
                        data = await resp.read()
                        if len(data) > 500:
                            filepath.write_bytes(data)
                            return str(filepath)
            except Exception:
                await asyncio.sleep(1)
    return ""


async def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("JavBus 女优列表爬取")
    print("=" * 60)

    connector = aiohttp.TCPConnector(limit=10)
    async with aiohttp.ClientSession(connector=connector, headers=HEADERS, cookies=COOKIES) as session:

        # 第一阶段：探测总页数
        print("\n[1/3] 探测总页数...")
        total_pages = await find_last_page(session)
        if total_pages == 0:
            print("无法获取任何数据，退出")
            return
        print(f"  总页数: {total_pages}")

        # 第二阶段：并发抓取所有页面
        print(f"\n[2/3] 抓取演员列表 ({total_pages} 页, 并发={PAGE_CONCURRENCY})...")
        all_actresses: list[dict] = []
        page_sem = asyncio.Semaphore(PAGE_CONCURRENCY)

        BATCH = 20
        for batch_start in range(1, total_pages + 1, BATCH):
            batch_end = min(batch_start + BATCH, total_pages + 1)
            tasks = [fetch_page(session, p, page_sem) for p in range(batch_start, batch_end)]
            pages_html = await asyncio.gather(*tasks)

            for i, html in enumerate(pages_html):
                if html:
                    actresses = parse_actresses(html)
                    all_actresses.extend(actresses)

            page_no = batch_end - 1
            print(f"  已完成: {min(page_no, total_pages)}/{total_pages} 页, 累计 {len(all_actresses)} 条")

        # 去重
        seen_urls: set[str] = set()
        unique: list[dict] = []
        for a in all_actresses:
            if a["url"] not in seen_urls:
                seen_urls.add(a["url"])
                unique.append(a)
        print(f"  总计 {len(all_actresses)} 条, 去重后 {len(unique)} 条")

        # 第三阶段：下载头像
        print(f"\n[3/3] 下载头像 ({len(unique)} 个, 并发={AVATAR_CONCURRENCY})...")
        avatar_sem = asyncio.Semaphore(AVATAR_CONCURRENCY)
        tasks = [download_avatar(session, a, avatar_sem) for a in unique]
        avatar_results = await asyncio.gather(*tasks)
        success = sum(1 for r in avatar_results if r)
        print(f"  头像下载: {success}/{len(unique)}")

        # 写 CSV
        print(f"\n写入 CSV: {CSV_PATH}")
        with open(CSV_PATH, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["name", "url", "avatar_local", "avatar_url"])
            for i, a in enumerate(unique):
                writer.writerow([a["name"], a["url"], avatar_results[i], a["avatar"]])

        print(f"\n{'=' * 60}")
        print(f"完成!")
        print(f"  CSV:   {CSV_PATH}")
        print(f"  头像:  {AVATAR_DIR}/ ({success} 个)")
        print(f"  演员:  {len(unique)} 人")
        print(f"{'=' * 60}")


if __name__ == "__main__":
    asyncio.run(main())
