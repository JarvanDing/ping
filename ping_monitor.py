#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import subprocess
import os
import datetime
import platform
import time
import argparse
import sqlite3
import concurrent.futures
import math
import sys
import json
import logging
from logging.handlers import RotatingFileHandler

# 日志配置
LOG_FILE = "ping_monitor.log"
LOG_FORMAT = "%(asctime)s - %(levelname)s - %(message)s"
LOG_LEVEL = logging.INFO
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10MB
BACKUP_COUNT = 5

# 配置日志
def setup_logger():
    """配置日志记录器"""
    logger = logging.getLogger("ping_monitor")
    logger.setLevel(LOG_LEVEL)
    
    # 创建日志目录
    log_dir = os.path.dirname(LOG_FILE)
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    # 文件处理器（带轮转）
    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=MAX_LOG_SIZE,
        backupCount=BACKUP_COUNT,
        encoding='utf-8'
    )
    file_handler.setFormatter(logging.Formatter(LOG_FORMAT))
    
    # 控制台处理器
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT))
    
    # 添加处理器
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

# 创建日志记录器
logger = setup_logger()

# 指定要ping的IP地址列表及其地区
IPS = [
    {"ip": "129.150.63.51", "region": "美国-凤凰城"},
    {"ip": "2603:c024:450a:90ab:fc23:a611:7a38:ca2d", "region": "美国-圣何塞"},
    {"ip": "140.238.25.169", "region": "日本-东京"},
    {"ip": "2603:c022:8001:8b08:6ddb:7f1a:75c:cf89", "region": "韩国-首尔"},
    {"ip": "43.134.207.202", "region": "新加坡"}
]

# IP配置文件
IP_CONFIG_FILE = "ip_config.json"

# 加载IP配置
def load_ip_config():
    """从JSON文件加载IP配置"""
    global IPS, IP_ADDRESSES
    if os.path.exists(IP_CONFIG_FILE):
        try:
            with open(IP_CONFIG_FILE, 'r', encoding='utf-8') as f:
                IPS = json.load(f)
            # 更新IP地址列表
            IP_ADDRESSES = [item["ip"] for item in IPS]
            logger.info(f"成功加载IP配置，共{len(IPS)}个IP")
            return True
        except Exception as e:
            logger.error(f"加载IP配置失败: {str(e)}")
            return False
    else:
        # 创建默认配置
        save_ip_config()
        return True

# 保存IP配置
def save_ip_config():
    """将IP配置保存到JSON文件"""
    try:
        with open(IP_CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(IPS, f, ensure_ascii=False, indent=4)
        logger.info(f"成功保存IP配置到{IP_CONFIG_FILE}")
        return True
    except Exception as e:
        logger.error(f"保存IP配置失败: {str(e)}")
        return False

# 添加IP
def add_ip(ip, region):
    """添加一个新的IP及其地区"""
    # 检查IP是否已存在
    for item in IPS:
        if item["ip"] == ip:
            logger.warning(f"IP {ip} 已存在，地区为 {item['region']}")
            return False
            
    # 添加新IP
    IPS.append({"ip": ip, "region": region})
    # 保存配置
    if save_ip_config():
        logger.info(f"成功添加 IP: {ip}, 地区: {region}")
        # 更新IP地址列表
        global IP_ADDRESSES
        IP_ADDRESSES = [item["ip"] for item in IPS]
        return True
    return False

# 修改IP地区
def update_ip_region(ip, region):
    """修改现有IP的地区信息"""
    for i, item in enumerate(IPS):
        if item["ip"] == ip:
            old_region = item["region"]
            IPS[i]["region"] = region
            if save_ip_config():
                logger.info(f"成功更新 IP: {ip} 的地区从 {old_region} 到 {region}")
                return True
            return False
    
    logger.warning(f"IP {ip} 不存在")
    return False

# 删除IP
def delete_ip(ip):
    """删除一个IP"""
    for i, item in enumerate(IPS):
        if item["ip"] == ip:
            region = item["region"]
            IPS.pop(i)
            if save_ip_config():
                logger.info(f"成功删除 IP: {ip}, 地区: {region}")
                # 更新IP地址列表
                global IP_ADDRESSES
                IP_ADDRESSES = [item["ip"] for item in IPS]
                return True
            return False
    
    logger.warning(f"IP {ip} 不存在")
    return False

# 更新JavaScript配置
def update_js_config():
    """更新JavaScript配置文件中的IP列表"""
    js_file = "ping_monitor.js"
    if not os.path.exists(js_file):
        logger.error(f"JavaScript文件 {js_file} 不存在")
        return False
    
    try:
        # 读取JavaScript文件
        with open(js_file, 'r', encoding='utf-8') as f:
            js_content = f.read()
        
        # 构建新的IP配置字符串
        ip_config_str = "const IPS = [\n"
        for item in IPS:
            ip_config_str += f'    {{ip: "{item["ip"]}", region: "{item["region"]}"}},\n'
        ip_config_str += "];"
        
        # 使用正则表达式替换IP配置部分
        import re
        pattern = r'const IPS = \[.*?\];'
        new_js_content = re.sub(pattern, ip_config_str, js_content, flags=re.DOTALL)
        
        # 保存更新后的JavaScript文件
        with open(js_file, 'w', encoding='utf-8') as f:
            f.write(new_js_content)
        
        logger.info(f"成功更新JavaScript配置文件 {js_file}")
        return True
    except Exception as e:
        logger.error(f"更新JavaScript配置失败: {str(e)}")
        return False

# 初始化IP地址列表，注意这里仅包含IP而不是完整的字典对象
IP_ADDRESSES = [item["ip"] for item in IPS]

# 每个IP ping的次数
PING_COUNT = 10

# 数据库文件路径
DB_FILE = "ping_data.db"

# 数据库备份目录
BACKUP_DIR = "backups"

def backup_database():
    """备份数据库文件"""
    if not os.path.exists(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)
    
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"ping_data_{timestamp}.db")
    
    try:
        import shutil
        shutil.copy2(DB_FILE, backup_file)
        logger.info(f"数据库备份成功: {backup_file}")
        return True
    except Exception as e:
        logger.error(f"数据库备份失败: {str(e)}")
        return False

def cleanup_old_data(days=30):
    """清理指定天数前的数据"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 计算截止日期
        cutoff_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
        
        # 删除旧数据
        cursor.execute("DELETE FROM ping_results WHERE timestamp < ?", (cutoff_date,))
        deleted_count = cursor.rowcount
        
        conn.commit()
        conn.close()
        
        logger.info(f"成功清理{deleted_count}条{days}天前的数据")
        return True
    except Exception as e:
        logger.error(f"清理旧数据失败: {str(e)}")
        return False

def init_database():
    """初始化SQLite数据库"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 创建ping结果表
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS ping_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            region TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            success INTEGER NOT NULL,
            avg_latency REAL,
            min_latency REAL,
            max_latency REAL,
            packet_loss INTEGER,
            latencies TEXT,
            error TEXT
        )
        ''')
        
        # 创建索引以提高查询效率
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ip ON ping_results (ip)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_timestamp ON ping_results (timestamp)')
        
        conn.commit()
        conn.close()
        logger.info("数据库初始化成功")
    except Exception as e:
        logger.error(f"数据库初始化失败: {str(e)}")
        raise

def get_ip_region(ip):
    """根据IP获取对应的地区信息"""
    for item in IPS:
        if item["ip"] == ip:
            return item["region"]
    return "未知地区"

def ping_ip(ip):
    """对指定IP进行ping测试并返回结果"""
    results = []
    
    # 根据操作系统调整ping命令
    ping_cmd = []
    if platform.system().lower() == "windows":
        # Windows系统下的ping命令
        ping_cmd = ["ping", "-n", str(PING_COUNT), "-w", "1000", ip]  # 添加1秒超时
    else:
        # Linux/Mac系统下的ping命令
        ping_cmd = ["ping", "-c", str(PING_COUNT), "-W", "1", ip]  # 添加1秒超时
    
    try:
        # 执行ping命令
        output = subprocess.check_output(ping_cmd, universal_newlines=True, stderr=subprocess.STDOUT)
        
        # 解析输出提取延迟数据
        lines = output.splitlines()
        for line in lines:
            if "time=" in line or "时间=" in line:
                # 提取延迟值
                parts = line.split("time=") if "time=" in line else line.split("时间=")
                if len(parts) > 1:
                    latency_part = parts[1].strip().split()[0]
                    latency = float(latency_part.replace("ms", ""))
                    results.append(latency)
        
        # 计算平均、最小、最大延迟
        if results:
            avg_latency = sum(results) / len(results)
            min_latency = min(results)
            max_latency = max(results)
            return {
                "success": True,
                "latencies": results,
                "average": round(avg_latency),  # 精确到整数
                "min": round(min_latency),      # 精确到整数
                "max": round(max_latency),      # 精确到整数
                "packet_loss": PING_COUNT - len(results)
            }
        else:
            return {
                "success": False,
                "error": "无法解析延迟值"
            }
    except subprocess.CalledProcessError as e:
        logger.error(f"Ping {ip} 失败: {str(e)}")
        return {
            "success": False,
            "error": "Ping请求失败"
        }
    except Exception as e:
        logger.error(f"Ping {ip} 出错: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

def save_result_to_db(result):
    """将结果保存到SQLite数据库"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 获取IP对应的地区
        region = get_ip_region(result["ip"])
        
        if result["success"]:
            cursor.execute('''
            INSERT INTO ping_results 
            (ip, region, timestamp, success, avg_latency, min_latency, max_latency, packet_loss, latencies, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                result["ip"],
                region,
                result["timestamp"],
                1,  # success=True
                result["average"],
                result["min"],
                result["max"],
                result["packet_loss"],
                ','.join(str(x) for x in result["latencies"]),
                None
            ))
        else:
            cursor.execute('''
            INSERT INTO ping_results 
            (ip, region, timestamp, success, avg_latency, min_latency, max_latency, packet_loss, latencies, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                result["ip"],
                region,
                result["timestamp"],
                0,  # success=False
                None,
                None,
                None,
                PING_COUNT,  # 全部丢包
                None,
                result["error"]
            ))
        
        conn.commit()
        conn.close()
        logger.debug(f"成功保存 {result['ip']} 的测试结果到数据库")
    except Exception as e:
        logger.error(f"保存测试结果到数据库失败: {str(e)}")

def run_ping_test():
    """执行ping测试并更新数据"""
    try:
        # 初始化数据库（如果不存在）
        init_database()
        
        # 备份数据库
        backup_database()
        
        # 清理旧数据
        cleanup_old_data()
        
        # 当前时间戳
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # 使用线程池并行执行ping测试
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(IP_ADDRESSES), 5)) as executor:  # 限制最大并发数
            # 提交所有ping任务
            future_to_ip = {executor.submit(ping_ip, ip): ip for ip in IP_ADDRESSES}
            
            # 处理结果
            for future in concurrent.futures.as_completed(future_to_ip):
                ip = future_to_ip[future]
                try:
                    result = future.result()
                    result["ip"] = ip
                    result["timestamp"] = timestamp
                    
                    # 保存到数据库
                    save_result_to_db(result)
                    
                    logger.info(f"IP {ip} ({get_ip_region(ip)}) 测试完成")
                except Exception as e:
                    logger.error(f"IP {ip} 测试出错: {str(e)}")
        
        logger.info("所有Ping测试完成，数据已保存到数据库")
    except Exception as e:
        logger.error(f"执行ping测试失败: {str(e)}")

def main():
    """主函数"""
    try:
        # 先加载IP配置
        load_ip_config()
        
        # 解析命令行参数
        parser = argparse.ArgumentParser(description='Ping监控工具')
        parser.add_argument('--info', action='store_true', help='显示当前配置的IP和地区信息')
        parser.add_argument('--add', nargs=2, metavar=('IP', '地区'), help='添加新的IP和地区')
        parser.add_argument('--update', nargs=2, metavar=('IP', '新地区'), help='更新IP的地区信息')
        parser.add_argument('--delete', metavar='IP', help='删除指定IP')
        parser.add_argument('--cleanup', type=int, metavar='天数', help='清理指定天数前的数据')
        args = parser.parse_args()

        if args.info:
            # 显示配置的IP和地区信息
            print("当前配置的IP和地区信息:")
            for item in IPS:
                print(f"IP: {item['ip']:<45} 地区: {item['region']}")
            return
        
        elif args.add:
            # 添加新IP和地区
            ip, region = args.add
            if add_ip(ip, region):
                update_js_config()
            return
        
        elif args.update:
            # 更新IP的地区信息
            ip, region = args.update
            if update_ip_region(ip, region):
                update_js_config()
            return
        
        elif args.delete:
            # 删除指定IP
            if delete_ip(args.delete):
                update_js_config()
            return
            
        elif args.cleanup:
            # 清理旧数据
            cleanup_old_data(args.cleanup)
            return

        # 执行ping测试
        run_ping_test()
    except Exception as e:
        logger.error(f"程序执行失败: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main() 