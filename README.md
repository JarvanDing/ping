# Ping监控工具

这是一个简单的网络监控工具，用于测试指定IP地址的ping延迟情况，并通过基于Web的界面展示结果。

## 功能特点

- 对多个IP地址进行并行ping测试
- 使用SQLite数据库存储测试结果，解决数据量大的问题
- 使用SQL.js在浏览器中直接查询SQLite数据库，无需服务器处理
- 支持按日期和IP筛选数据
- 跨平台支持（Windows/Linux/MacOS）
- 显示IP地区信息
- 平均延迟精确到整数显示
- 显示丢包率统计
- 并行执行提高速度
- 完全客户端渲染，减少服务器负载
- 方便的IP和地区管理功能
- 自动数据库备份和清理
- 详细的日志记录
- 可配置的ping超时设置

## 文件说明

- `ping_monitor.py` - 用于执行ping测试并将结果保存到数据库
- `ping_data.db` - SQLite数据库文件（自动创建）
- `index.html` - 静态HTML页面
- `ping_monitor.js` - 客户端JavaScript代码，用于加载和显示数据
- `ip_config.json` - IP和地区配置文件（自动创建）
- `ping_monitor.log` - 日志文件（自动创建）
- `backups/` - 数据库备份目录（自动创建）

## 使用方法

### 执行ping测试

只需直接运行Python脚本：

```bash
python ping_monitor.py
```

这将执行一次ping测试并将结果保存到SQLite数据库。

### 查看当前配置的IP和地区信息

```bash
python ping_monitor.py --info
```

### IP管理功能

#### 添加新的IP和地区
```bash
python ping_monitor.py --add <IP地址> "<地区名称>"
```

例如：
```bash
python ping_monitor.py --add 8.8.8.8 "谷歌-DNS"
```

#### 修改IP的地区信息
```bash
python ping_monitor.py --update <IP地址> "<新的地区名称>"
```

例如：
```bash
python ping_monitor.py --update 8.8.8.8 "谷歌-公共DNS"
```

#### 删除IP
```bash
python ping_monitor.py --delete <IP地址>
```

例如：
```bash
python ping_monitor.py --delete 8.8.8.8
```

### 数据管理功能

#### 清理旧数据
```bash
python ping_monitor.py --cleanup <天数>
```

例如，清理30天前的数据：
```bash
python ping_monitor.py --cleanup 30
```

### 查看结果

无需生成HTML文件，只需在浏览器中打开`index.html`文件即可:

1. 将文件夹部署到Web服务器目录
2. 访问`index.html`页面
3. 页面将自动加载SQLite数据库并显示结果

页面功能包括：
- **IP状态概览**：显示每个IP的最新状态、平均延迟和丢包率
- **数据筛选**：可按日期范围和IP筛选数据
- **分页浏览**：支持按页浏览大量数据
- **详细数据表**：显示每次测试的详细结果，包括地区、延迟值和丢包率

## 设置自动定时执行

您可以使用系统的定时任务工具来设定定期执行ping测试：

### Linux/macOS (使用cron)

编辑crontab：

```bash
crontab -e
```

添加以下内容（每小时执行一次）：

```
0 * * * * cd /path/to/script && python ping_monitor.py
```

### Windows (使用任务计划程序)

1. 打开任务计划程序
2. 创建基本任务，选择"每小时"运行
3. 设置程序路径为`python`，参数为`C:\path\to\ping_monitor.py`
4. 完成设置

## 自定义配置

您可以通过以下两种方式自定义监控的IP地址：

1. 使用命令行工具管理（推荐）：
   - 使用`--add`、`--update`和`--delete`参数管理IP和地区配置
   - 系统会自动更新JavaScript文件中的配置

2. 直接编辑配置文件：
   - 编辑`ip_config.json`文件
   - 修改后需要重新运行脚本以更新JavaScript配置

## 日志管理

程序会自动创建和管理日志文件：

- 日志文件位置：`ping_monitor.log`
- 日志轮转：当日志文件达到10MB时自动轮转
- 保留最近的5个日志文件
- 日志级别：INFO（可修改）

## 数据库管理

程序会自动管理数据库：

- 自动备份：每次执行ping测试前自动备份数据库
- 备份文件位置：`backups/`目录
- 自动清理：默认清理30天前的数据
- 可通过`--cleanup`参数自定义清理天数

## 技术说明

本项目使用以下技术：

- **Python**: 用于执行ping测试
- **SQLite**: 高效的本地数据库，用于存储测试结果
- **SQL.js**: 在浏览器中运行SQLite的JavaScript实现
- **Bootstrap**: 用于页面布局和样式
- **Logging**: 用于日志记录和管理

## 数据库结构

SQLite数据库表结构：
- `id`: 记录ID
- `ip`: IP地址
- `region`: IP所属地区
- `timestamp`: 测试时间
- `success`: 测试是否成功
- `avg_latency`: 平均延迟
- `min_latency`: 最小延迟
- `max_latency`: 最大延迟
- `packet_loss`: 丢包数量
- `latencies`: 所有延迟值（逗号分隔）
- `error`: 错误信息（如果有） 