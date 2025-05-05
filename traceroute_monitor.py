#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import subprocess
import os
import platform
import re
import time
import argparse
import json
import logging
import requests
import concurrent.futures
import sqlite3
import datetime
from logging.handlers import RotatingFileHandler

# --- 配置区 ---
# IP 配置文件，与 ping_monitor.py 共享
IP_CONFIG_FILE = "ip_config.json"
# 日志配置
LOG_FILE = "traceroute_monitor.log"
LOG_FORMAT = "%(asctime)s - %(levelname)s - %(message)s"
LOG_LEVEL = logging.INFO
MAX_LOG_SIZE = 5 * 1024 * 1024  # 5MB
BACKUP_COUNT = 3
# IP 地理位置查询 API (限制: 45次/分钟)
IP_GEOLOCATION_API_URL = "http://ip-api.com/json/{ip}?fields=status,message,country,regionName,city,query"
# 并发执行 Traceroute 的最大线程数
MAX_WORKERS = 5
# Traceroute 超时设置 (秒) - 注意：这可能不适用于所有 traceroute 实现
TRACEROUTE_TIMEOUT = 30
# IP 地址正则表达式 (IPv4)
IPV4_REGEX = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
# 简化版 IPv6 正则表达式 (可能无法覆盖所有边缘情况，但适用于常见格式)
IPV6_REGEX = re.compile(r'([a-fA-F0-9:]+:+[a-fA-F0-9:]+)') # 匹配包含 '::' 的地址
# 备用/更复杂的 IPv6 正则式 (如果上面的不够用)
# IPV6_REGEX = re.compile(r'(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))')
# 数据库文件路径 (与 ping_monitor.py 共享)
DB_FILE = "ping_data.db"
# 数据保留天数
DATA_RETENTION_DAYS = 30

# --- 日志配置 ---
def setup_logger():
    """配置日志记录器"""
    logger = logging.getLogger("traceroute_monitor")
    logger.setLevel(LOG_LEVEL)
    
    log_dir = os.path.dirname(LOG_FILE)
    if log_dir and not os.path.exists(log_dir):
        try:
            os.makedirs(log_dir)
        except OSError as e:
            print(f"无法创建日志目录 {log_dir}: {e}")
            # 如果无法创建日志目录，则禁用文件日志记录
            file_handler = None
    else:
        file_handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=MAX_LOG_SIZE,
            backupCount=BACKUP_COUNT,
            encoding='utf-8'
        )
        file_handler.setFormatter(logging.Formatter(LOG_FORMAT))

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT))
    
    if file_handler:
        logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

logger = setup_logger()

# --- 全局变量 ---
TARGET_IPS = [] # 将从配置文件加载

# --- 函数定义 ---

def is_ipv6(ip_str):
    """简单检查字符串是否可能为 IPv6 地址"""
    return ':' in ip_str

def load_ip_config():
    """从JSON文件加载IP配置"""
    global TARGET_IPS
    if os.path.exists(IP_CONFIG_FILE):
        try:
            with open(IP_CONFIG_FILE, 'r', encoding='utf-8') as f:
                ips_data = json.load(f)
            # 提取 IP 地址
            TARGET_IPS = [item["ip"] for item in ips_data]
            logger.info(f"成功从 {IP_CONFIG_FILE} 加载 {len(TARGET_IPS)} 个目标 IP")
            return True
        except Exception as e:
            logger.error(f"加载IP配置 {IP_CONFIG_FILE} 失败: {str(e)}")
            return False
    else:
        logger.warning(f"IP配置文件 {IP_CONFIG_FILE} 未找到，无目标 IP 可追踪。")
        return False

def get_ip_geolocation(ip):
    """查询IP地址的地理位置信息"""
    # 跳过私有IP地址和回环地址
    if ip.startswith(('10.', '172.', '192.168.', '127.')):
         # 粗略判断，未覆盖所有私有地址范围
        if ip.startswith('172.'):
            second_octet = int(ip.split('.')[1])
            if 16 <= second_octet <= 31:
                return {"status": "success", "country": "Private", "regionName": "RFC1918", "city": "Local Network", "query": ip}
        elif ip.startswith('192.168.'):
             return {"status": "success", "country": "Private", "regionName": "RFC1918", "city": "Local Network", "query": ip}
        elif ip.startswith('10.'):
             return {"status": "success", "country": "Private", "regionName": "RFC1918", "city": "Local Network", "query": ip}
        elif ip.startswith('127.'):
             return {"status": "success", "country": "Local", "regionName": "Loopback", "city": "localhost", "query": ip}


    api_url = IP_GEOLOCATION_API_URL.format(ip=ip)
    try:
        # 设置超时
        response = requests.get(api_url, timeout=5)
        response.raise_for_status() # 如果状态码不是 2xx，则抛出异常
        data = response.json()
        
        if data.get("status") == "success":
            # 简化地名，去除 "Province" 或 "Region" 等词语
            region = data.get('regionName', '').replace(' Province', '').replace(' Region', '')
            city = data.get('city', '')
            country = data.get('country', '')
            
            location_parts = [part for part in [country, region, city] if part]
            location_str = " - ".join(location_parts) if location_parts else "未知地点"
            
            return {"status": "success", "location": location_str, "query": data.get("query")}
        else:
            logger.warning(f"IP {ip} 地理位置查询失败: {data.get('message', '未知错误')}")
            return {"status": "fail", "message": data.get("message"), "query": ip, "location": "查询失败"}
            
    except requests.exceptions.Timeout:
        logger.warning(f"IP {ip} 地理位置查询超时")
        return {"status": "fail", "message": "查询超时", "query": ip, "location": "查询超时"}
    except requests.exceptions.RequestException as e:
        logger.error(f"IP {ip} 地理位置查询请求错误: {str(e)}")
        return {"status": "fail", "message": str(e), "query": ip, "location": "查询错误"}
    except json.JSONDecodeError:
        logger.error(f"无法解析 IP {ip} 地理位置查询的响应: {response.text}")
        return {"status": "fail", "message": "响应解析失败", "query": ip, "location": "解析失败"}

def parse_traceroute_output(output, os_type):
    """解析traceroute/tracert命令的输出，提取IP地址 (支持 IPv4 和 IPv6)"""
    hops = []
    lines = output.strip().splitlines()
    
    # 跳过标题行
    start_line = 0
    if os_type == "windows":
        # Windows tracert 通常有几行标题
        for i, line in enumerate(lines):
            if re.match(r'\s*\d+\s+', line): # 找到第一个以数字开头的行（跳数）
                start_line = i
                break
    elif os_type == "linux":
        # Linux traceroute 通常第一行是标题
        if lines and "traceroute to" in lines[0]:
            start_line = 1
            
    current_hop_num = 0
    processed_ips_in_hop = set() # 防止同一跳处理多次相同的IP

    for line in lines[start_line:]:
        line = line.strip()
        if not line:
            continue

        hop_num_match = re.match(r'^\s*(\d+)', line)
        if hop_num_match:
            current_hop_num = int(hop_num_match.group(1))
            processed_ips_in_hop = set() # 新的一跳，重置已处理IP集合

        # 查找行中的所有 IPv4 和 IPv6 地址
        # 优先查找 IPv6
        ips_found = IPV6_REGEX.findall(line)
        if not ips_found:
            # 如果没找到 IPv6，再查找 IPv4
            ips_found = IPV4_REGEX.findall(line)

        if "*" in line and not ips_found:
            # 超时或请求无法到达
            if current_hop_num > 0 and not any(h['hop'] == current_hop_num for h in hops):
                hops.append({"hop": current_hop_num, "ip": "*", "location": "请求超时"})
            continue

        # 通常一行只关心一个IP，取找到的最后一个作为代表
        ip_to_process = ips_found[-1] if ips_found else None

        if ip_to_process:
             # 确保这个 IP 属于当前跳且未被处理过
            if current_hop_num > 0 and ip_to_process not in processed_ips_in_hop:
                 # 检查是否已经为这一跳添加了条目，如果是，更新IP（有时一行会有多个IP，通常取最后一个）
                 existing_hop_index = next((i for i, h in enumerate(hops) if h['hop'] == current_hop_num), -1)
                 if existing_hop_index != -1:
                     # 如果现有条目是超时 "*", 则替换它
                     if hops[existing_hop_index]["ip"] == "*":
                         hops[existing_hop_index]["ip"] = ip_to_process
                     # 否则，可能一行解析出多个IP，我们可能需要更复杂的逻辑，暂时只记录第一个有效IP
                     # 或者根据操作系统行为判断，通常windows tracert一行一个IP，linux可能一个IP或域名+IP
                 else:
                    hops.append({"hop": current_hop_num, "ip": ip_to_process, "location": "查询中..."})
                 processed_ips_in_hop.add(ip_to_process) # 标记为已处理


    # 过滤掉没有有效IP的初始条目（例如标题行误匹配）
    hops = [h for h in hops if h['hop'] > 0]
    
    # 去重（可能由于解析逻辑不完美导致重复跳数和IP）
    unique_hops = []
    seen_hops = set()
    for hop in hops:
        hop_tuple = (hop['hop'], hop['ip'])
        if hop_tuple not in seen_hops:
            unique_hops.append(hop)
            seen_hops.add(hop_tuple)

    return unique_hops

# --- 数据库相关函数 ---

def init_traceroute_database():
    """初始化 Traceroute 结果的数据库表"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 创建 traceroute 结果表
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS traceroute_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_ip TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            hops_json TEXT,  -- 存储 Hops 列表的 JSON 字符串
            error TEXT       -- 存储执行过程中的错误信息
        )
        ''')
        
        # 创建索引以提高查询效率
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_traceroute_target_ip ON traceroute_results (target_ip)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_traceroute_timestamp ON traceroute_results (timestamp)')
        
        conn.commit()
        conn.close()
        logger.info("Traceroute 数据库表初始化成功")
        return True
    except Exception as e:
        logger.error(f"Traceroute 数据库表初始化失败: {str(e)}")
        return False

def save_traceroute_to_db(result):
    """将 Traceroute 结果保存到数据库"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        target_ip = result['target']
        hops = result.get('hops')
        error = result.get('error')
        
        # 将 hops 列表转换为 JSON 字符串
        hops_json = json.dumps(hops, ensure_ascii=False) if hops else None
        
        cursor.execute('''
        INSERT INTO traceroute_results (target_ip, timestamp, hops_json, error)
        VALUES (?, ?, ?, ?)
        ''', (target_ip, timestamp, hops_json, error))
        
        conn.commit()
        conn.close()
        logger.debug(f"成功保存 {target_ip} 的 Traceroute 结果到数据库")
        return True
    except Exception as e:
        logger.error(f"保存 Traceroute 结果到数据库失败 ({target_ip}): {str(e)}")
        return False

def cleanup_old_traceroute_data(days=DATA_RETENTION_DAYS):
    """清理指定天数前的 Traceroute 数据"""
    if days <= 0:
        logger.info("数据清理天数设置为0或负数，跳过清理。")
        return True
        
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 计算截止日期
        cutoff_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
        
        # 删除旧数据
        cursor.execute("DELETE FROM traceroute_results WHERE timestamp < ?", (cutoff_date,))
        deleted_count = cursor.rowcount
        
        conn.commit()
        
        # 执行 VACUUM 优化数据库文件大小 (可选，但推荐)
        logger.info(f"开始优化数据库文件...")
        conn.execute("VACUUM")
        conn.close()
        
        if deleted_count > 0:
            logger.info(f"成功清理 {deleted_count} 条 {days} 天前的 Traceroute 数据")
        else:
            logger.info(f"没有超过 {days} 天的旧 Traceroute 数据需要清理")
        return True
    except Exception as e:
        logger.error(f"清理旧 Traceroute 数据失败: {str(e)}")
        return False

# --- 主要逻辑函数 ---

def trace_route(target_ip):
    """执行traceroute/tracert命令并解析结果 (支持 IPv6)"""
    logger.info(f"开始追踪到 {target_ip} 的路由...")
    hops = []
    os_type = platform.system().lower()
    use_ipv6 = is_ipv6(target_ip)
    
    if os_type == "windows":
        # Windows 使用 tracert
        command = ["tracert", "-d", "-w", "1000"]
        if use_ipv6:
            command.append("-6")
        command.append(target_ip)
    elif os_type == "linux" or os_type == "darwin": # darwin is MacOS
        # Linux/Mac 使用 traceroute
        command = ["traceroute", "-n", "-w", "2", "-q", "1"]
        if use_ipv6:
            command.append("-6")
        command.append(target_ip)
    else:
        logger.warning(f"检测到可能不支持的操作系统: {platform.system()}. 尝试使用 'traceroute' 命令，可能需要手动调整参数。")
        # 尝试通用 traceroute 命令，可能需要用户安装并自行确认是否支持 IPv6
        command = ["traceroute", "-n"]
        if use_ipv6:
             command.append("-6") # 尝试添加 -6
        command.append(target_ip)

    try:
        # 使用 Popen 以便更好地处理可能的长时运行和输出流
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, encoding='utf-8', errors='ignore')
        
        try:
            # 设置超时等待进程结束
            stdout, stderr = process.communicate(timeout=TRACEROUTE_TIMEOUT)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
            logger.warning(f"Traceroute 到 {target_ip} 超时 ({TRACEROUTE_TIMEOUT} 秒)")
            return {"target": target_ip, "hops": [], "error": "Traceroute 执行超时"}

        if process.returncode != 0 and stderr:
            # 有些 traceroute 实现（如 MTR 伪装的）会将正常输出打印到 stderr
            # 我们主要关心是否有输出可以解析
            if not stdout and stderr:
                 logger.warning(f"Traceroute 到 {target_ip} 命令执行可能有误 (返回码 {process.returncode}), 但 stderr 包含输出，尝试解析 stderr:\n{stderr}")
                 output = stderr
            elif stderr:
                 logger.warning(f"Traceroute 到 {target_ip} 命令执行可能有误 (返回码 {process.returncode})，stderr:\n{stderr}")
                 output = stdout # 仍然尝试解析 stdout
            else:
                 logger.error(f"Traceroute 到 {target_ip} 命令执行失败，返回码: {process.returncode}")
                 return {"target": target_ip, "hops": [], "error": f"Traceroute 命令执行失败 (code: {process.returncode})"}
        else:
             output = stdout

        if not output:
             logger.warning(f"Traceroute 到 {target_ip} 没有输出。")
             return {"target": target_ip, "hops": [], "error": "Traceroute 没有输出"}

        # 解析输出
        hops = parse_traceroute_output(output, "windows" if os_type == "windows" else "linux")
        
        # 查询每个 hop IP 的地理位置
        # 使用线程池加速查询，但注意 API 限速
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_hop = {executor.submit(get_ip_geolocation, hop["ip"]): hop for hop in hops if hop["ip"] != "*"}
            
            for future in concurrent.futures.as_completed(future_to_hop):
                hop_entry = future_to_hop[future]
                try:
                    geo_result = future.result()
                    if geo_result and geo_result["status"] == "success":
                        hop_entry["location"] = geo_result.get("location", "未知地点")
                    else:
                         # 保留原始的"查询失败"或"超时"等信息
                         hop_entry["location"] = geo_result.get("location", "查询出错")
                except Exception as exc:
                    logger.error(f'查询IP {hop_entry["ip"]} 地理位置时产生异常: {exc}')
                    hop_entry["location"] = "查询异常" # 更新地理位置为错误信息

        logger.info(f"完成追踪到 {target_ip} 的路由，共 {len(hops)} 跳。")
        # 构建成功结果字典
        result_data = {"target": target_ip, "hops": hops, "error": None}
        
        # 保存到数据库
        save_traceroute_to_db(result_data)
        
        return result_data # 返回结果供打印

    except FileNotFoundError:
        error_msg = "traceroute/tracert 命令未找到"
        logger.error(f"找不到 traceroute/tracert 命令。请确保它已安装并在系统 PATH 中。")
        result_data = {"target": target_ip, "hops": [], "error": error_msg}
        save_traceroute_to_db(result_data) # 保存错误信息到数据库
        return result_data
    except Exception as e:
        error_msg = f"意外错误: {str(e)}"
        logger.error(f"执行 traceroute 到 {target_ip} 时发生意外错误: {str(e)}")
        result_data = {"target": target_ip, "hops": [], "error": error_msg}
        save_traceroute_to_db(result_data) # 保存错误信息到数据库
        return result_data

def print_results(results):
    """格式化并打印 Traceroute 结果"""
    for result in results:
        target_ip = result["target"]
        hops = result["hops"]
        error = result["error"]

        print("-" * 60)
        print(f"路由追踪结果: {target_ip}")
        print("-" * 60)

        if error:
            print(f"错误: {error}")
        elif not hops:
            print("未能获取到路由信息。")
        else:
            print(f"{'跳数':<5} {'IP 地址':<45} {'地区':<40}")
            print("-" * 60)
            for hop in hops:
                 # 格式化输出，确保对齐
                 ip_str = hop.get('ip', '*')
                 location_str = hop.get('location', '')
                 print(f"{hop['hop']:<5} {ip_str:<45} {location_str:<40}")
        
        print("\n") # 每个目标 IP 结果后加一个空行


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='Traceroute 监控工具，记录到目标IP的路由路径及地区信息，并将结果存入数据库。')
    parser.add_argument('--target', type=str, help='指定要追踪的单个目标 IP 地址。如果指定，将忽略配置文件。')
    parser.add_argument('--cleanup-days', type=int, default=DATA_RETENTION_DAYS, help=f'清理多少天前的旧数据 (默认: {DATA_RETENTION_DAYS} 天), 设置为 0 则不清理')
    
    args = parser.parse_args()

    # 初始化数据库表
    if not init_traceroute_database():
        logger.error("无法初始化数据库，程序退出。")
        return
        
    # 清理旧数据
    cleanup_old_traceroute_data(args.cleanup_days)

    ips_to_trace = []

    if args.target:
        logger.info(f"使用命令行指定的单一目标 IP: {args.target}")
        ips_to_trace = [args.target]
    else:
        logger.info(f"尝试从 {IP_CONFIG_FILE} 加载目标 IP 列表...")
        if load_ip_config():
            ips_to_trace = TARGET_IPS
        else:
            logger.error("无法加载 IP 配置，程序退出。")
            return # 退出

    if not ips_to_trace:
        logger.warning("没有指定或加载到任何目标 IP 地址，无法执行 Traceroute。")
        print("请通过 --target 参数指定 IP 或确保 ip_config.json 文件存在且包含有效的 IP 地址。")
        return

    logger.info(f"将对以下 {len(ips_to_trace)} 个 IP 执行 Traceroute: {', '.join(ips_to_trace)}")
    
    all_results = []
    # 使用线程池并行执行 traceroute
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(ips_to_trace))) as executor:
        future_to_ip = {executor.submit(trace_route, ip): ip for ip in ips_to_trace}
        
        for future in concurrent.futures.as_completed(future_to_ip):
            ip = future_to_ip[future]
            try:
                result = future.result()
                all_results.append(result)
            except Exception as exc:
                logger.error(f'Traceroute 任务针对 IP {ip} 产生异常: {exc}')
                all_results.append({"target": ip, "hops": [], "error": f"任务执行异常: {exc}"})

    # 对结果按原始 IP 列表顺序排序（如果需要）
    # all_results.sort(key=lambda r: ips_to_trace.index(r['target']))

    # 打印结果 (注意：保存数据库的操作已经在 trace_route 函数内部完成)
    print_results(all_results)
    
    logger.info("所有 Traceroute 任务完成。")


if __name__ == "__main__":
    main() 