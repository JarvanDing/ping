// 全局SQL.js数据库对象
let db = null;

// IP列表和配置信息
const IPS = [
    {ip: "129.150.63.51", region: "美国-凤凰城"},
    {ip: "2603:c024:450a:90ab:fc23:a611:7a38:ca2d", region: "美国-圣何塞"},
    {ip: "140.238.25.169", region: "日本-东京"},
    {ip: "2603:c022:8001:8b08:6ddb:7f1a:75c:cf89", region: "韩国-首尔"},
    {ip: "43.134.207.202", region: "HongKong"},
];

// 全局状态和配置
const PING_COUNT = 10;
let currentPage = 1;
let pageSize = 25;
let totalPages = 1;
let totalRecords = 0;
let filters = {
    startDate: '',
    endDate: '',
    ipFilter: ''
};

// 加载SQL.js
async function initSqlJs() {
    try {
        // 更新加载进度
        updateProgress(10, "正在初始化SQL.js...");
        
        // 初始化SQL.js
        // 修复：使用CDN直接加载SQL.js并等待其初始化
        const sqlPromise = initSqlJsWithCDN();
        const SQL = await sqlPromise;
        
        // 更新加载进度
        updateProgress(30, "正在加载数据库文件...");
        
        // 加载数据库文件
        const response = await fetch('ping_data.db');
        if (!response.ok) {
            throw new Error('无法加载数据库文件：' + response.statusText);
        }
        
        // 获取数据库文件内容
        const arrayBuffer = await response.arrayBuffer();
        
        // 更新加载进度
        updateProgress(70, "正在处理数据库...");
        
        // 打开数据库
        const uInt8Array = new Uint8Array(arrayBuffer);
        db = new SQL.Database(uInt8Array);
        
        // 更新加载进度
        updateProgress(100, "数据库加载完成！");
        
        // 隐藏加载指示器
        setTimeout(() => {
            document.getElementById('loadingIndicator').style.display = 'none';
        }, 500);
        
        // 初始化页面
        initPage();
    } catch (error) {
        console.error('加载数据库出错：', error);
        
        // 显示友好的错误信息
        const loadingIndicator = document.getElementById('loadingIndicator');
        loadingIndicator.innerHTML = `
            <div class="card-body">
                <h5 class="text-danger">加载失败</h5>
                <div class="alert alert-danger">
                    <p><strong>错误信息：</strong> ${error.message}</p>
                    <hr>
                    <p><strong>可能的解决方案：</strong></p>
                    <ul>
                        <li>请确保您的浏览器支持WebAssembly (WASM)</li>
                        <li>如果使用隐私浏览或有内容拦截插件，请尝试关闭它们</li>
                        <li>尝试使用最新版Chrome、Firefox或Edge浏览器</li>
                        <li>检查您的网络连接是否可以访问CDN资源</li>
                    </ul>
                    <p class="mb-0">
                        <button onclick="location.reload()" class="btn btn-primary">重新加载页面</button>
                    </p>
                </div>
            </div>
        `;
    }
}

// 使用CDN初始化SQL.js
function initSqlJsWithCDN() {
    return new Promise((resolve, reject) => {
        try {
            // 先创建一个隐藏的div来显示SQL.js可能的错误信息
            const sqlJsErrorDiv = document.createElement('div');
            sqlJsErrorDiv.id = 'sqljsError';
            sqlJsErrorDiv.style.display = 'none';
            document.body.appendChild(sqlJsErrorDiv);
            
            // 动态加载SQL.js脚本
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js';
            script.onload = () => {
                // 确保window.initSqlJs存在
                if (typeof window.initSqlJs !== 'function') {
                    reject(new Error('SQL.js库加载失败：initSqlJs函数不存在'));
                    return;
                }
                
                // 配置wasm文件路径
                const config = {
                    locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${filename}`
                };
                
                // 初始化SQL.js
                window.initSqlJs(config)
                    .then(resolve)
                    .catch(err => {
                        // 显示详细错误信息
                        sqlJsErrorDiv.style.display = 'block';
                        sqlJsErrorDiv.innerHTML = `<div class="alert alert-danger">
                            <h4>SQL.js加载错误</h4>
                            <p>${err.message}</p>
                            <p>请检查是否允许加载WebAssembly内容</p>
                        </div>`;
                        reject(err);
                    });
            };
            script.onerror = () => reject(new Error('无法加载SQL.js库'));
            document.head.appendChild(script);
        } catch (err) {
            reject(err);
        }
    });
}

// 更新加载进度
function updateProgress(percent, message) {
    const progressBar = document.getElementById('loadingProgress');
    const loadingText = document.getElementById('loadingText');
    
    progressBar.style.width = `${percent}%`;
    progressBar.setAttribute('aria-valuenow', percent);
    loadingText.textContent = message;
}

// 初始化页面
function initPage() {
    // 填充IP选择框
    populateIpSelect();
    
    // 获取日期范围
    const dateRange = getDateRange();
    
    // 设置日期选择器默认值
    if (dateRange.minDate) {
        document.getElementById('startDate').value = dateRange.minDate;
        filters.startDate = dateRange.minDate;
    }
    if (dateRange.maxDate) {
        document.getElementById('endDate').value = dateRange.maxDate;
        filters.endDate = dateRange.maxDate;
    }
    
    // 加载最新IP状态
    loadLatestResults();
    
    // 加载第一页数据
    loadPagedResults();
    
    // 设置事件监听器
    setupEventListeners();
}

// 填充IP选择框
function populateIpSelect() {
    const select = document.getElementById('ipFilter');
    
    // 清空现有选项（除了第一个）
    while (select.options.length > 1) {
        select.remove(1);
    }
    
    // 添加IP选项
    IPS.forEach(item => {
        const option = document.createElement('option');
        option.value = item.ip;
        option.textContent = `${item.ip} (${item.region})`;
        select.appendChild(option);
    });
}

// 获取数据库中的日期范围
function getDateRange() {
    try {
        const stmt = db.prepare("SELECT MIN(timestamp), MAX(timestamp) FROM ping_results");
        const result = stmt.getAsObject({});
        stmt.free();
        
        let minDate = null;
        let maxDate = null;
        
        if (result['MIN(timestamp)'] && result['MAX(timestamp)']) {
            minDate = result['MIN(timestamp)'].split(' ')[0];
            maxDate = result['MAX(timestamp)'].split(' ')[0];
        }
        
        return { minDate, maxDate };
    } catch (error) {
        console.error('获取日期范围出错：', error);
        return { minDate: null, maxDate: null };
    }
}

// 加载最新的IP状态
function loadLatestResults() {
    try {
        const results = [];
        
        // 查询每个IP的最新结果
        for (const ipInfo of IPS) {
            const ip = ipInfo.ip;
            const stmt = db.prepare(`
                SELECT * FROM ping_results 
                WHERE ip = ? 
                ORDER BY timestamp DESC 
                LIMIT 1
            `);
            
            stmt.bind([ip]);
            while (stmt.step()) {
                const row = stmt.getAsObject();
                results.push(row);
            }
            stmt.free();
        }
        
        // 更新摘要卡片
        updateSummaryCards(results);
        
        // 更新最后更新时间
        if (results.length > 0) {
            const latestTime = results.reduce((latest, current) => {
                return (latest.timestamp > current.timestamp) ? latest : current;
            }).timestamp;
            
            document.getElementById('lastUpdate').textContent = `最后更新时间: ${latestTime}`;
        }
    } catch (error) {
        console.error('加载最新结果出错：', error);
    }
}

// 更新摘要卡片
function updateSummaryCards(results) {
    const container = document.getElementById('summaryContainer');
    container.innerHTML = '';
    
    results.forEach(result => {
        const statusClass = result.success === 1 ? 'success' : 'error';
        const statusText = result.success === 1 ? '正常' : '错误';
        const avgLatency = result.success === 1 ? `${result.avg_latency} ms` : 'N/A';
        const packetLossRate = result.success === 1 ? 
            ((result.packet_loss / PING_COUNT) * 100).toFixed(1) + '%' : 
            '100%';
        
        const card = document.createElement('div');
        card.className = 'col-md-4 col-lg-3 col-xl-2 mb-3';
        card.innerHTML = `
            <div class="card summary-card">
                <div class="card-body">
                    <div class="ip-title">${result.ip}</div>
                    <div class="region-info">${result.region}</div>
                    <div class="status ${statusClass}">状态: ${statusText}</div>
                    <div>平均延迟: ${avgLatency}</div>
                    <div>丢包率: ${packetLossRate}</div>
                    <div class="small mt-2">
                        测试时间: ${result.timestamp}
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(card);
    });
}

// 加载分页结果
function loadPagedResults() {
    try {
        // 构建查询条件
        let whereClause = '';
        const params = [];
        const conditions = [];
        
        if (filters.startDate) {
            conditions.push("timestamp >= ?");
            params.push(`${filters.startDate} 00:00:00`);
        }
        
        if (filters.endDate) {
            conditions.push("timestamp <= ?");
            params.push(`${filters.endDate} 23:59:59`);
        }
        
        if (filters.ipFilter) {
            conditions.push("ip = ?");
            params.push(filters.ipFilter);
        }
        
        if (conditions.length > 0) {
            whereClause = "WHERE " + conditions.join(" AND ");
        }
        
        // 计算总记录数
        const countStmt = db.prepare(`SELECT COUNT(*) FROM ping_results ${whereClause}`);
        if (params.length > 0) {
            countStmt.bind(params);
        }
        
        countStmt.step();
        totalRecords = countStmt.get()[0];
        countStmt.free();
        
        // 计算总页数
        totalPages = Math.ceil(totalRecords / pageSize);
        
        // 限制当前页范围
        currentPage = Math.max(1, Math.min(currentPage, totalPages || 1));
        
        // 计算偏移量
        const offset = (currentPage - 1) * pageSize;
        
        // 查询分页数据
        const query = `
            SELECT * FROM ping_results 
            ${whereClause}
            ORDER BY timestamp DESC 
            LIMIT ? OFFSET ?
        `;
        
        const stmt = db.prepare(query);
        stmt.bind([...params, pageSize, offset]);
        
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        
        // 更新表格和分页控件
        updateResultTable(results);
        updatePagination();
        
    } catch (error) {
        console.error('加载分页结果出错：', error);
    }
}

// 更新结果表格
function updateResultTable(results) {
    const tableBody = document.getElementById('resultTable');
    tableBody.innerHTML = '';
    
    if (results.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="9" class="text-center">没有找到匹配的记录</td>';
        tableBody.appendChild(row);
        return;
    }
    
    results.forEach(entry => {
        const statusClass = entry.success === 1 ? 'success' : 'error';
        const statusText = entry.success === 1 ? '成功' : '失败';
        
        let avgLatency, minLatency, maxLatency, packetLoss, latenciesDisplay;
        
        if (entry.success === 1) {
            avgLatency = `${entry.avg_latency} ms`;
            minLatency = `${entry.min_latency} ms`;
            maxLatency = `${entry.max_latency} ms`;
            
            const packetLossRate = (entry.packet_loss / PING_COUNT) * 100;
            packetLoss = `${packetLossRate.toFixed(1)}%`;
            
            // 解析延迟数据
            const latencies = entry.latencies ? entry.latencies.split(',') : [];
            latenciesDisplay = latencies.map(lat => parseFloat(lat).toFixed(1)).join(', ');
        } else {
            avgLatency = 'N/A';
            minLatency = 'N/A';
            maxLatency = 'N/A';
            packetLoss = '100%';
            latenciesDisplay = entry.error || '未知错误';
        }
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${entry.ip}</td>
            <td>${entry.region}</td>
            <td>${entry.timestamp}</td>
            <td class="${statusClass}">${statusText}</td>
            <td>${avgLatency}</td>
            <td>${minLatency}</td>
            <td>${maxLatency}</td>
            <td>${packetLoss}</td>
            <td class="text-truncate" style="max-width: 200px;" title="${latenciesDisplay}">${latenciesDisplay}</td>
        `;
        
        tableBody.appendChild(row);
    });
}

// 更新分页控件
function updatePagination() {
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';
    
    // 页码信息
    document.getElementById('pageInfo').textContent = 
        `共 ${totalRecords} 条记录，${totalPages} 页`;
    
    // 如果只有一页则隐藏分页控件
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }
    
    pagination.style.display = 'flex';
    
    // 首页和上一页
    const prevDisabled = currentPage === 1;
    pagination.innerHTML += `
        <li class="page-item ${prevDisabled ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="1">首页</a>
        </li>
        <li class="page-item ${prevDisabled ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage - 1}">上一页</a>
        </li>
    `;
    
    // 显示页码范围
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const active = i === currentPage ? 'active' : '';
        pagination.innerHTML += `
            <li class="page-item ${active}">
                <a class="page-link" href="#" data-page="${i}">${i}</a>
            </li>
        `;
    }
    
    // 下一页和末页
    const nextDisabled = currentPage === totalPages;
    pagination.innerHTML += `
        <li class="page-item ${nextDisabled ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage + 1}">下一页</a>
        </li>
        <li class="page-item ${nextDisabled ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${totalPages}">末页</a>
        </li>
    `;
    
    // 添加事件监听器
    document.querySelectorAll('#pagination .page-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            if (this.parentElement.classList.contains('disabled')) return;
            
            const page = parseInt(this.getAttribute('data-page'));
            if (page !== currentPage) {
                currentPage = page;
                loadPagedResults();
            }
        });
    });
}

// 设置事件监听器
function setupEventListeners() {
    // 筛选表单提交
    document.getElementById('filterForm').addEventListener('submit', function(e) {
        e.preventDefault();
        
        filters.startDate = document.getElementById('startDate').value;
        filters.endDate = document.getElementById('endDate').value;
        filters.ipFilter = document.getElementById('ipFilter').value;
        
        currentPage = 1;
        loadPagedResults();
    });
    
    // 重置筛选
    document.getElementById('resetFilter').addEventListener('click', function() {
        document.getElementById('startDate').value = '';
        document.getElementById('endDate').value = '';
        document.getElementById('ipFilter').value = '';
        
        filters.startDate = '';
        filters.endDate = '';
        filters.ipFilter = '';
        
        currentPage = 1;
        loadPagedResults();
    });
    
    // 每页显示数量变化
    document.getElementById('pageSize').addEventListener('change', function() {
        pageSize = parseInt(this.value);
        currentPage = 1;
        loadPagedResults();
    });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 初始化SQL.js并加载数据库
    initSqlJs();
}); 