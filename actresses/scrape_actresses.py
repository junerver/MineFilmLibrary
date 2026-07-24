#!/usr/bin/env python3
"""
JavBus 女优列表爬取脚本 (curl 版) - 分阶段执行
阶段1: 抓取所有页面 → 立即写 CSV
阶段2: 后台下载头像（支持断点续传）
"""
import re
import csv
import json
import subprocess
import concurrent.futures
from pathlib import Path
from html.parser import HTMLParser

# ============ 配置 ============
BASE_URL = "https://www.javbus.com/actresses/"
OUTPUT_DIR = Path(__file__).resolve().parent
AVATAR_DIR = OUTPUT_DIR / "avators"
CSV_PATH = OUTPUT_DIR / "actresses.csv"
JSON_PATH = OUTPUT_DIR / "actresses_raw.json"
PAGE_WORKERS = 6
AVATAR_WORKERS = 15
RETRY = 3
CURL_HEADERS = [
    "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
    "-H", "Cookie: existmag=all",
]
# =============================


class ActressParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.actresses = []
        self._in_box = False
        self._in_photo = False
        self._cur = {}

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        cls = d.get("class") or ""
        if tag == "a" and "avatar-box" in cls:
            self._in_box = True
            self._cur = {"url": d.get("href", "")}
            if self._cur["url"].startswith("/"):
                self._cur["url"] = "https://www.javbus.com" + self._cur["url"]
        if self._in_box:
            if tag == "div" and "photo-frame" in cls:
                self._in_photo = True
            if tag == "img" and self._in_photo:
                src = d.get("src", "")
                if src.startswith("/"):
                    src = "https://www.javbus.com" + src
                self._cur["avatar"] = src
                self._cur["name"] = d.get("title", "")

    def handle_endtag(self, tag):
        if tag == "a" and self._in_box:
            self._in_box = False
            self._in_photo = False
            if self._cur.get("name"):
                self.actresses.append(dict(self._cur))
            self._cur = {}


def curl_fetch(url, timeout=15):
    cmd = ["curl", "-s", "--max-time", str(timeout)] + CURL_HEADERS + [url]
    for attempt in range(RETRY):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
            if r.returncode == 0 and len(r.stdout) > 500:
                if "driver-verify" not in r.stdout and "Age Verification" not in r.stdout:
                    return r.stdout
        except Exception:
            pass
    return None


def fetch_page(page_no):
    html = curl_fetch(f"{BASE_URL}{page_no}")
    if not html:
        return []
    p = ActressParser()
    p.feed(html)
    return p.actresses


def download_avatar(actress):
    url = actress.get("avatar", "")
    if not url:
        return ""
    safe_name = re.sub(r'[\\/:*?"<>|]', "_", actress["name"])
    fp = AVATAR_DIR / f"{safe_name}.jpg"
    if fp.exists() and fp.stat().st_size > 1000:
        return str(fp)
    cmd = ["curl", "-s", "--max-time", "15", "-o", str(fp), url]
    try:
        subprocess.run(cmd, capture_output=True, timeout=20)
        if fp.exists() and fp.stat().st_size > 500:
            return str(fp)
    except Exception:
        pass
    return ""


def phase1_scrape():
    """抓取所有页面，写入 JSON + CSV"""
    print("\n[阶段1] 抓取 1000 页演员列表...")
    all_data = []
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=PAGE_WORKERS) as pool:
        futures = {pool.submit(fetch_page, p): p for p in range(1, 1001)}
        for fut in concurrent.futures.as_completed(futures):
            try:
                all_data.extend(fut.result())
            except Exception:
                pass
            done += 1
            if done % 100 == 0 or done == 1000:
                print(f"  进度: {done}/1000 页, 累计 {len(all_data)} 条")

    # 去重
    seen = set()
    unique = []
    for a in all_data:
        if a["url"] not in seen:
            seen.add(a["url"])
            unique.append(a)
    print(f"  去重: {len(all_data)} → {len(unique)}")

    # 保存 JSON (供阶段2用)
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(unique, f, ensure_ascii=False)

    # 立即写 CSV
    with open(CSV_PATH, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["name", "url", "avatar_url"])
        for a in unique:
            writer.writerow([a["name"], a["url"], a["avatar"]])
    print(f"  CSV 已写入: {CSV_PATH} ({len(unique)} 条)")
    return unique


def phase2_avatars(unique):
    """下载头像（支持断点续传）"""
    existing = len(list(AVATAR_DIR.glob("*.jpg")))
    print(f"\n[阶段2] 下载头像 ({len(unique)} 个, 已有 {existing}, 并发={AVATAR_WORKERS})...")
    success = 0
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=AVATAR_WORKERS) as pool:
        futures = {pool.submit(download_avatar, a): a for a in unique}
        for fut in concurrent.futures.as_completed(futures):
            done += 1
            try:
                if fut.result():
                    success += 1
            except Exception:
                pass
            if done % 500 == 0 or done == len(unique):
                print(f"  头像: {done}/{len(unique)} (成功 {success})")
    return success


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("JavBus 女优列表爬取 (分阶段版)")
    print("=" * 60)

    # 阶段1: 如果已有 JSON 就直接用，否则重新抓取
    if JSON_PATH.exists():
        print(f"\n已有数据: {JSON_PATH}, 跳过抓取")
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            unique = json.load(f)
        # 同时检查 CSV
        if not CSV_PATH.exists():
            with open(CSV_PATH, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerow(["name", "url", "avatar_url"])
                for a in unique:
                    writer.writerow([a["name"], a["url"], a["avatar"]])
    else:
        unique = phase1_scrape()

    # 阶段2: 下载头像
    success = phase2_avatars(unique)

    print(f"\n{'=' * 60}")
    print(f"全部完成!")
    print(f"  CSV:   {CSV_PATH}")
    print(f"  头像:  {AVATAR_DIR}/ ({success} 个)")
    print(f"  演员:  {len(unique)} 人")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
