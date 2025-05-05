// 全局变量
let db = null;
let charts = {};

// 初始化SQL.js
async function initializeSqlJs() {
    try {
        const SQL = await window.initSqlJs({
            locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.8.0/dist/${file}`
        });
        return SQL;
    } catch (err) {
        console.error('初始化SQL.js失败:', err);
        throw err;
    }
}

// 加载数据库
async function loadDatabase() {
    try {
        const SQL = await initializeSqlJs();
        const response = await fetch('ping_data.db');
        const arrayBuffer = await response.arrayBuffer();
        db = new SQL.Database(new Uint8Array(arrayBuffer));
        return true;
    } catch (err) {
        console.error('加载数据库失败:', err);
        return false;
    }
}

// 更新加载进度
function updateLoadingProgress(progress, text) {
    const progressBar = document.getElementById('loadingProgress');
    const loadingText = document.getElementById('loadingText');
    progressBar.style.width = `${progress}%`;
    loadingText.textContent = text;
}

// 计算趋势
function calculateTrend(current, previous) {
    if (!previous || previous === 0) return { value: 0, text: 'N/A', class: 'text-muted' }; // 处理分母为0的情况
    const change = ((current - previous) / previous) * 100;
    // 避免 -0%
    const changeFixed = change === 0 ? 0 : change.toFixed(1);
    return {
        value: change,
        text: `${change > 0 ? '+' : ''}${changeFixed}%`,
        class: change > 0 ? 'trend-up' : 'trend-down'
    };
}

// 更新概览数据
function updateOverview() {
    const query7days = `
        SELECT 
            AVG(avg_latency) as avg_latency_7d,
            AVG(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100 as packet_loss_7d,
            AVG((max_latency - min_latency) / avg_latency) as stability_index_7d,
            COUNT(*) as test_count_7d
        FROM ping_results
        WHERE timestamp >= datetime('now', '-7 days') AND avg_latency IS NOT NULL AND avg_latency > 0
    `;
    const query14days = `
        SELECT 
            AVG(avg_latency) as avg_latency_14d,
            AVG(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100 as packet_loss_14d,
            AVG((max_latency - min_latency) / avg_latency) as stability_index_14d
        FROM ping_results
        WHERE timestamp >= datetime('now', '-14 days') AND timestamp < datetime('now', '-7 days') AND avg_latency IS NOT NULL AND avg_latency > 0
    `;

    try {
        const result7days = db.exec(query7days)[0];
        const result14days = db.exec(query14days)[0];

        if (result7days && result7days.values && result7days.values.length > 0) {
            const data7d = result7days.values[0];
            const data14d = (result14days && result14days.values && result14days.values.length > 0) ? result14days.values[0] : [null, null, null];
            
            // 更新平均延迟
            const avgLatency7d = Math.round(data7d[0] || 0);
            const avgLatency14d = data14d[0] !== null ? Math.round(data14d[0]) : null;
            const latencyTrend = calculateTrend(avgLatency7d, avgLatency14d);
            document.getElementById('avgLatency').textContent = `${avgLatency7d}ms`;
            const latencyTrendElement = document.getElementById('latencyTrend');
            latencyTrendElement.textContent = latencyTrend.text;
            latencyTrendElement.className = `trend ${latencyTrend.class}`;
            
            // 更新丢包率
            const packetLoss7d = (data7d[1] || 0).toFixed(1);
            const packetLoss14d = data14d[1] !== null ? data14d[1] : null;
            const packetLossTrend = calculateTrend(packetLoss7d, packetLoss14d);
            document.getElementById('packetLoss').textContent = `${packetLoss7d}%`;
            const packetLossTrendElement = document.getElementById('packetLossTrend');
            packetLossTrendElement.textContent = packetLossTrend.text;
            packetLossTrendElement.className = `trend ${packetLossTrend.class}`;

            // 计算稳定性指数（基于延迟标准差改进）
            // 避免 stability_index_7d 为 NaN 或 Infinity
            const stabilityValue7d = data7d[2];
            const stabilityIndex7d = (stabilityValue7d !== null && isFinite(stabilityValue7d)) ? Math.max(0, Math.min(100, (1 - stabilityValue7d) * 100)).toFixed(1) : 0;
            const stabilityValue14d = data14d[2];
            const stabilityIndex14d = (stabilityValue14d !== null && isFinite(stabilityValue14d)) ? Math.max(0, Math.min(100, (1 - stabilityValue14d) * 100)) : null;
            const stabilityTrend = calculateTrend(stabilityIndex7d, stabilityIndex14d);
            document.getElementById('stabilityIndex').textContent = `${stabilityIndex7d}%`;
            const stabilityTrendElement = document.getElementById('stabilityTrend');
            stabilityTrendElement.textContent = stabilityTrend.text;
            stabilityTrendElement.className = `trend ${stabilityTrend.class}`;
            
            // 更新测试次数
            document.getElementById('testCount').textContent = data7d[3] || 0;
        } else {
            console.warn("No data found for the last 7 days.");
            // 可以设置默认值或显示提示信息
             document.getElementById('avgLatency').textContent = 'N/A';
             document.getElementById('packetLoss').textContent = 'N/A';
             document.getElementById('stabilityIndex').textContent = 'N/A';
             document.getElementById('testCount').textContent = '0';
        }
    } catch (e) {
        console.error("Error updating overview:", e);
        // 处理错误，例如显示错误信息
    }
}

// 创建延迟分布图
function createLatencyDistributionChart() {
    const query = `
        SELECT 
            CASE 
                WHEN avg_latency < 50 THEN '0-50ms'
                WHEN avg_latency < 100 THEN '50-100ms'
                WHEN avg_latency < 200 THEN '100-200ms'
                WHEN avg_latency < 500 THEN '200-500ms'
                ELSE '500ms+'
            END as range,
            COUNT(*) as count
        FROM ping_results
        WHERE timestamp >= datetime('now', '-7 days') AND avg_latency IS NOT NULL
        GROUP BY range
        ORDER BY MIN(avg_latency)
    `;
    
    try {
        const result = db.exec(query)[0];
        if (result && result.values && result.values.length > 0) {
            const ctx = document.getElementById('latencyDistributionChart').getContext('2d');
            // 销毁旧图表实例（如果存在）
            if (charts.latencyDistribution) {
                charts.latencyDistribution.destroy();
            }
            charts.latencyDistribution = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: result.values.map(row => row[0]),
                    datasets: [{
                        label: '测试次数',
                        data: result.values.map(row => row[1]),
                        backgroundColor: 'rgba(75, 192, 192, 0.6)', // 更换颜色
                        borderColor: 'rgba(75, 192, 192, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '测试次数'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: '平均延迟范围'
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: false // 隐藏图例
                        }
                    }
                }
            });
        } else {
             console.warn("No data for latency distribution chart.");
        }
    } catch (e) {
        console.error("Error creating latency distribution chart:", e);
    }
}

// --- 新增分析功能 ---

// 填充趋势分析IP选择下拉框
function populateTrendIpFilter() {
    const selectElement = document.getElementById('trendIpFilter');
    if (!selectElement) return;

    try {
        const query = `SELECT DISTINCT ip FROM ping_results ORDER BY ip`;
        const result = db.exec(query)[0];
        if (result && result.values) {
            result.values.forEach(row => {
                const option = document.createElement('option');
                option.value = row[0];
                option.textContent = row[0];
                selectElement.appendChild(option);
            });
        }
    } catch (e) {
        console.error("Error populating IP filter for trends:", e);
    }
}

// 计算在线率
function calculateUptime(successCount, totalCount) {
    if (totalCount === 0) return 0;
    return ((successCount / totalCount) * 100);
}

// 计算标准差 (抖动)
function calculateStandardDeviation(values) {
    const n = values.length;
    if (n === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
    return Math.sqrt(variance);
}

// 创建在线率图表
function createUptimeChart() {
    const query = `
        SELECT 
            ip,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
            COUNT(*) as total_count
        FROM ping_results
        WHERE timestamp >= datetime('now', '-7 days')
        GROUP BY ip
        ORDER BY (SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*)) DESC
    `;

    try {
        const result = db.exec(query)[0];
        if (result && result.values && result.values.length > 0) {
            const ips = result.values.map(row => row[0]);
            const uptimes = result.values.map(row => calculateUptime(row[1], row[2]).toFixed(1));

            // 计算总体平均在线率
            const totalSuccess = result.values.reduce((sum, row) => sum + row[1], 0);
            const totalCount = result.values.reduce((sum, row) => sum + row[2], 0);
            const overallUptime = calculateUptime(totalSuccess, totalCount).toFixed(1);
            document.getElementById('overallUptime').textContent = `${overallUptime}%`;

            const ctx = document.getElementById('uptimeChart').getContext('2d');
            if (charts.uptime) charts.uptime.destroy();
            charts.uptime = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ips,
                    datasets: [{
                        label: '在线率 (%)',
                        data: uptimes,
                        backgroundColor: uptimes.map(u => u >= 99.9 ? 'rgba(40, 167, 69, 0.7)' : u >= 99 ? 'rgba(255, 193, 7, 0.7)' : 'rgba(220, 53, 69, 0.7)'), // 根据在线率显示不同颜色
                        borderColor: uptimes.map(u => u >= 99.9 ? 'rgba(40, 167, 69, 1)' : u >= 99 ? 'rgba(255, 193, 7, 1)' : 'rgba(220, 53, 69, 1)'),
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y', // 将条形图改为水平方向，方便查看IP
                    scales: {
                        x: {
                            beginAtZero: true,
                            max: 100,
                            title: {
                                display: true,
                                text: '在线率 (%)'
                            }
                        },
                        y: {
                            ticks: {
                                autoSkip: false // 防止IP标签被跳过
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        }
                    }
                }
            });
        } else {
            console.warn("No data for uptime chart.");
            document.getElementById('overallUptime').textContent = 'N/A';
            // 可以显示提示信息
        }
    } catch (e) {
        console.error("Error creating uptime chart:", e);
         document.getElementById('overallUptime').textContent = '错误';
    }
}

// 创建抖动对比图表
function createJitterComparisonChart() {
    // 获取所有 IP 的延迟数据
    const latencyQuery = `
        SELECT ip, avg_latency
        FROM ping_results
        WHERE timestamp >= datetime('now', '-7 days') 
        AND avg_latency IS NOT NULL AND success = 1
    `;

    try {
        const latencyResult = db.exec(latencyQuery)[0];
        if (latencyResult && latencyResult.values && latencyResult.values.length > 0) {
            // 按 IP 分组延迟数据
            const latenciesByIp = latencyResult.values.reduce((acc, [ip, latency]) => {
                if (!acc[ip]) {
                    acc[ip] = [];
                }
                acc[ip].push(latency);
                return acc;
            }, {});

            // 计算每个 IP 的抖动（标准差）
            const jitterData = Object.entries(latenciesByIp).map(([ip, latencies]) => ({
                ip: ip,
                jitter: calculateStandardDeviation(latencies).toFixed(2) // 计算标准差
            }));

            // 按抖动值排序
            jitterData.sort((a, b) => a.jitter - b.jitter);

            const ctx = document.getElementById('jitterComparisonChart').getContext('2d');
            if (charts.jitterComparison) charts.jitterComparison.destroy();
            charts.jitterComparison = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: jitterData.map(d => d.ip),
                    datasets: [{
                        label: '延迟抖动 (ms)',
                        data: jitterData.map(d => d.jitter),
                        backgroundColor: 'rgba(108, 117, 125, 0.6)', // 中性灰色
                        borderColor: 'rgba(108, 117, 125, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '抖动 (延迟标准差 - ms)'
                            }
                        },
                        x: {
                             title: {
                                display: true,
                                text: 'IP 地址'
                            }
                        }
                    },
                     plugins: {
                        legend: {
                            display: false
                        }
                    }
                }
            });

        } else {
            console.warn("No latency data found for jitter calculation.");
            // 在图表区域显示提示
             const canvas = document.getElementById('jitterComparisonChart');
             const ctx = canvas.getContext('2d');
             ctx.clearRect(0, 0, canvas.width, canvas.height);
             ctx.textAlign = 'center';
             ctx.fillText('没有足够的延迟数据来计算抖动', canvas.width / 2, canvas.height / 2);
        }
    } catch (e) {
        console.error("Error creating jitter comparison chart:", e);
    }
}

// --- 结束 新增分析功能 ---

// 创建趋势图 (修改)
function createTrendCharts(selectedIp = 'all') { // 接收 selectedIp 参数，默认为 'all'
    let latencyWhereClause = "avg_latency IS NOT NULL";
    let packetLossWhereClause = "1=1"; // Base condition
    let titleSuffix = '总体';

    if (selectedIp && selectedIp !== 'all') {
        latencyWhereClause += ` AND ip = '${selectedIp.replace(/'/g, "''")}'`; // Add IP filter and escape single quotes
        packetLossWhereClause += ` AND ip = '${selectedIp.replace(/'/g, "''")}'`;
        titleSuffix = selectedIp;
    }

    // 更新图表标题
    document.getElementById('latencyTrendHeader').textContent = `延迟趋势 (近30天 - ${titleSuffix})`;
    document.getElementById('packetLossTrendHeader').textContent = `丢包率趋势 (近30天 - ${titleSuffix})`;

    // 延迟趋势
    const latencyQuery = `
        SELECT 
            strftime('%Y-%m-%d', timestamp) as date,
            AVG(avg_latency) as avg_latency
        FROM ping_results
        WHERE timestamp >= datetime('now', '-30 days') AND ${latencyWhereClause}
        GROUP BY date
        ORDER BY date
    `;
    
    try {
        const latencyResult = db.exec(latencyQuery)[0];
        const latencyCtx = document.getElementById('latencyTrendChart').getContext('2d');
        if (charts.latencyTrend) charts.latencyTrend.destroy(); // 销毁旧图表

        if (latencyResult && latencyResult.values && latencyResult.values.length > 0) {
            charts.latencyTrend = new Chart(latencyCtx, {
                type: 'line',
                data: {
                    labels: latencyResult.values.map(row => row[0]),
                    datasets: [{
                        label: `平均延迟 (${titleSuffix})`,
                        data: latencyResult.values.map(row => Math.round(row[1] || 0)),
                        borderColor: 'rgba(54, 162, 235, 1)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        tension: 0.1,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: false,
                            title: {
                                display: true,
                                text: '延迟 (ms)'
                            }
                        },
                         x: {
                            title: {
                                display: true,
                                text: '日期'
                            }
                        }
                    }
                }
            });
        } else {
             console.warn(`No data for latency trend chart (${titleSuffix}).`);
             // 清空画布并显示提示
             latencyCtx.clearRect(0, 0, latencyCtx.canvas.width, latencyCtx.canvas.height);
             latencyCtx.textAlign = 'center';
             latencyCtx.fillText('没有找到符合条件的延迟趋势数据', latencyCtx.canvas.width / 2, latencyCtx.canvas.height / 2);
        }
    } catch (e) {
        console.error(`Error creating latency trend chart (${titleSuffix}):`, e);
    }
    
    // 丢包率趋势
    const packetLossQuery = `
        SELECT 
            strftime('%Y-%m-%d', timestamp) as date,
            AVG(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100 as packet_loss
        FROM ping_results
        WHERE timestamp >= datetime('now', '-30 days') AND ${packetLossWhereClause}
        GROUP BY date
        ORDER BY date
    `;
    
    try {
        const packetLossResult = db.exec(packetLossQuery)[0];
        const packetLossCtx = document.getElementById('packetLossTrendChart').getContext('2d');
         if (charts.packetLossTrend) charts.packetLossTrend.destroy(); // 销毁旧图表

        if (packetLossResult && packetLossResult.values && packetLossResult.values.length > 0) {
            charts.packetLossTrend = new Chart(packetLossCtx, {
                type: 'line',
                data: {
                    labels: packetLossResult.values.map(row => row[0]),
                    datasets: [{
                        label: `丢包率 (${titleSuffix})`,
                        data: packetLossResult.values.map(row => (row[1] || 0).toFixed(1)),
                        borderColor: 'rgba(255, 99, 132, 1)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        tension: 0.1,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            title: {
                                display: true,
                                text: '丢包率 (%)'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: '日期'
                            }
                        }
                    }
                }
            });
        } else {
             console.warn(`No data for packet loss trend chart (${titleSuffix}).`);
             // 清空画布并显示提示
             packetLossCtx.clearRect(0, 0, packetLossCtx.canvas.width, packetLossCtx.canvas.height);
             packetLossCtx.textAlign = 'center';
             packetLossCtx.fillText('没有找到符合条件的丢包率趋势数据', packetLossCtx.canvas.width / 2, packetLossCtx.canvas.height / 2);
        }
     } catch (e) {
        console.error(`Error creating packet loss trend chart (${titleSuffix}):`, e);
    }
}

// 创建稳定性热力图 (调整为散点图)
function createStabilityHeatmap() {
    const query = `
        SELECT 
            ip, 
            AVG(avg_latency) as avg_latency,
            -- 修正稳定性指数计算，避免除以0
            CASE 
                WHEN AVG(avg_latency) IS NULL OR AVG(avg_latency) = 0 THEN 0
                ELSE AVG((max_latency - min_latency) / avg_latency) 
            END as stability_raw,
            COUNT(*) as test_count
        FROM ping_results
        WHERE timestamp >= datetime('now', '-7 days') AND avg_latency IS NOT NULL
        GROUP BY ip
    `;
    
    try {
        const result = db.exec(query)[0];
        if (result && result.values && result.values.length > 0) {
            const ctx = document.getElementById('stabilityHeatmapChart').getContext('2d');
            const data = result.values.map(row => {
                const stabilityRaw = row[2];
                const stabilityIndex = (stabilityRaw !== null && isFinite(stabilityRaw)) ? Math.max(0, Math.min(100, (1 - stabilityRaw) * 100)) : 0;
                return {
                    ip: row[0],
                    latency: Math.round(row[1] || 0),
                    stability: stabilityIndex.toFixed(1),
                    count: row[3]
                };
            });
            
            if (charts.stabilityHeatmap) charts.stabilityHeatmap.destroy();
            charts.stabilityHeatmap = new Chart(ctx, {
                type: 'bubble',
                data: {
                    datasets: data.map((item, index) => ({
                        label: item.ip, // 移除地区
                        data: [{
                            x: item.latency,
                            y: parseFloat(item.stability), // 确保是数字
                            r: Math.sqrt(item.count) * 2 // 半径表示测试次数
                        }],
                        // 使用不同的颜色区分IP
                        backgroundColor: `hsla(${index * 360 / data.length}, 70%, 60%, 0.6)`,
                        borderColor: `hsla(${index * 360 / data.length}, 70%, 40%, 1)`,
                    }))
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: '平均延迟 (ms)'
                            }
                        },
                        y: {
                            min: 0, // Y轴从0开始
                            max: 100, // Y轴到100结束
                            title: {
                                display: true,
                                text: '稳定性指数 (%)'
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                             callbacks: {
                                label: function(context) {
                                    const datasetLabel = context.dataset.label || '';
                                    const point = context.raw;
                                    return `${datasetLabel}: (${point.x}ms, ${point.y}%), 次数: ${Math.round(Math.pow(point.r / 2, 2))}`;
                                }
                            }
                        }
                    }
                }
            });
        } else {
             console.warn("No data for stability heatmap.");
        }
    } catch (e) {
        console.error("Error creating stability heatmap:", e);
    }
}

// 更新异常事件表格
function updateAnomalyTable() {
    const query = `
        SELECT 
            ip,
            COUNT(*) as anomaly_count,
            MAX(strftime('%Y-%m-%d %H:%M:%S', timestamp)) as last_anomaly, /* 格式化时间 */
            GROUP_CONCAT(DISTINCT CASE WHEN error IS NULL OR error = '' THEN '超时' ELSE error END) as error_types /* 处理空错误 */
        FROM ping_results
        WHERE success = 0
        AND timestamp >= datetime('now', '-7 days')
        GROUP BY ip
        ORDER BY anomaly_count DESC
    `;
    
    try {
        const result = db.exec(query)[0];
        const tbody = document.getElementById('anomalyTable');
        tbody.innerHTML = ''; // 清空旧数据
        
        if (result && result.values && result.values.length > 0) {
            result.values.forEach(row => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${row[0]}</td>
                    <td><span class="badge bg-danger">${row[1]}</span></td> <!-- 使用徽章显示数量 -->
                    <td>${row[2]}</td>
                    <td>${row[3]}</td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            // 显示没有异常的提示
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="4" class="text-center text-muted p-3">最近7天没有异常事件</td>`;
            tbody.appendChild(tr);
        }
    } catch (e) {
        console.error("Error updating anomaly table:", e);
        const tbody = document.getElementById('anomalyTable');
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger p-3">加载异常数据失败</td></tr>`;
    }
}

// 创建对比图表
function createComparisonCharts() {
    // IP性能对比
    const ipQuery = `
        SELECT 
            ip,
            AVG(avg_latency) as avg_latency,
            AVG(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100 as packet_loss
        FROM ping_results
        WHERE timestamp >= datetime('now', '-7 days') AND avg_latency IS NOT NULL
        GROUP BY ip
        ORDER BY avg_latency
    `;
    
    try {
        const ipResult = db.exec(ipQuery)[0];
        if (ipResult && ipResult.values && ipResult.values.length > 0) {
            const ctx = document.getElementById('ipComparisonChart').getContext('2d');
            if (charts.ipComparison) charts.ipComparison.destroy();
            charts.ipComparison = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ipResult.values.map(row => row[0]), // 只显示IP
                    datasets: [{
                        label: '平均延迟 (ms)',
                        data: ipResult.values.map(row => Math.round(row[1] || 0)),
                        backgroundColor: 'rgba(75, 192, 192, 0.6)',
                        borderColor: 'rgba(75, 192, 192, 1)',
                        borderWidth: 1,
                        yAxisID: 'y'
                    }, {
                        label: '丢包率 (%)',
                        data: ipResult.values.map(row => (row[2] || 0).toFixed(1)),
                        backgroundColor: 'rgba(255, 99, 132, 0.6)',
                        borderColor: 'rgba(255, 99, 132, 1)',
                        borderWidth: 1,
                        yAxisID: 'y1',
                        type: 'line', // 保持折线图类型
                        tension: 0.1,
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: {
                                display: true,
                                text: '平均延迟 (ms)'
                            },
                            beginAtZero: true
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            title: {
                                display: true,
                                text: '丢包率 (%)'
                            },
                            grid: {
                                drawOnChartArea: false // 不绘制背景网格线
                            },
                            beginAtZero: true,
                            max: 100
                        },
                        x: {
                             title: {
                                display: true,
                                text: 'IP 地址'
                            }
                        }
                    },
                    plugins: {
                         tooltip: {
                            mode: 'index', // 索引模式，同时显示两个数据集的值
                            intersect: false,
                        }
                    }
                }
            });
        } else {
            console.warn("No data for IP comparison chart.");
        }
    } catch (e) {
        console.error("Error creating IP comparison chart:", e);
    }
    
    // 移除地区性能对比图表创建逻辑
    /*
    const regionQuery = ...
    const regionResult = ...
    if (regionResult) {
        const ctx = document.getElementById('regionComparisonChart').getContext('2d');
        if (charts.regionComparison) charts.regionComparison.destroy();
        charts.regionComparison = new Chart(ctx, { ... });
    }
    */
}

// --- 路由追踪数据显示函数 (修改为从 DB 加载) ---
async function loadAndDisplayTracerouteFromDB() {
    const resultsContainer = document.getElementById('tracerouteResultsContainer');
    const lastUpdatedElement = document.getElementById('lastUpdated');
    if (!resultsContainer || !lastUpdatedElement) {
        console.warn("Traceroute 相关元素未找到，无法加载数据。");
        return;
    }
    
    if (!db) {
        console.error("数据库尚未加载，无法查询 Traceroute 数据。");
        resultsContainer.innerHTML = `<div class="col-12"><p class="text-center text-danger">数据库加载失败，无法显示路由追踪数据。</p></div>`;
        lastUpdatedElement.textContent = '路由追踪数据加载失败';
        return;
    }

    resultsContainer.innerHTML = '<div class="col-12 text-center"><div class="spinner-container"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div></div>';
    lastUpdatedElement.textContent = '正在从数据库加载路由追踪数据...';

    try {
        // SQL 查询：获取每个 target_ip 的最新记录
        // 使用子查询或 ROW_NUMBER() 来获取每个分组的最新记录（取决于 sql.js 支持的 SQLite 版本）
        // 这里使用子查询的方式，更通用
        const query = `
            SELECT t1.target_ip, t1.timestamp, t1.hops_json, t1.error
            FROM traceroute_results t1
            INNER JOIN (
                SELECT target_ip, MAX(timestamp) as max_ts
                FROM traceroute_results
                GROUP BY target_ip
            ) t2 ON t1.target_ip = t2.target_ip AND t1.timestamp = t2.max_ts
            ORDER BY t1.target_ip;
        `;
        
        const results = db.exec(query);
        
        resultsContainer.innerHTML = ''; // 清空加载指示器

        if (results.length > 0 && results[0].values && results[0].values.length > 0) {
            // 假设数据最后更新时间是最后一条记录的时间戳
            const lastTimestamp = results[0].values[results[0].values.length - 1][1]; 
            lastUpdatedElement.textContent = `路由追踪数据基于数据库记录 (最新记录时间: ${lastTimestamp})`;

            const dataToDisplay = results[0].values.map(row => {
                let hops = [];
                if (row[2]) { // hops_json
                    try {
                        hops = JSON.parse(row[2]);
                    } catch (e) {
                        console.warn(`无法解析 IP ${row[0]} 的 hops_json 数据: ${row[2]}`, e);
                        hops = []; // 出错时设为空列表
                    }
                }
                return {
                    target_ip: row[0],
                    timestamp: row[1],
                    hops: hops,
                    error: row[3]
                };
            });
            displayTracerouteResults(dataToDisplay); // 调用显示函数
        } else {
            lastUpdatedElement.textContent = '数据库中未找到有效的路由追踪数据。';
            resultsContainer.innerHTML = '<div class="col-12"><p class="text-center text-muted">数据库中未找到有效的路由追踪数据。</p></div>';
        }

    } catch (error) {
        console.error('从数据库加载或处理路由追踪数据失败:', error);
        resultsContainer.innerHTML = `<div class="col-12"><p class="text-center text-danger">加载路由追踪数据失败: ${error.message}</p></div>`;
        lastUpdatedElement.textContent = '路由追踪数据加载失败';
    }
}

// 修改显示函数，增加过滤星号行的逻辑
function displayTracerouteResults(results) {
    const resultsContainer = document.getElementById('tracerouteResultsContainer');
    results.forEach(result => {
        const col = document.createElement('div');
        col.className = 'col-md-12 mb-4'; 
        const card = document.createElement('div');
        card.className = 'card h-100';
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header d-flex justify-content-between align-items-center'; 
        cardHeader.innerHTML = `
            <span>目标 IP: <strong>${result.target_ip}</strong></span>
            <small>时间: ${result.timestamp}</small>
        `;
        const cardBody = document.createElement('div');
        cardBody.className = 'card-body p-0';

        if (result.error) {
            cardBody.style.padding = '1.5rem';
            cardBody.innerHTML = `<p class="error-text">追踪过程中发生错误: ${result.error}</p>`;
        } else if (result.hops && result.hops.length > 0) {
            const tableContainer = document.createElement('div');
            tableContainer.className = 'table-responsive';
            const table = document.createElement('table');
            table.className = 'table table-sm table-striped table-hover mb-0';
            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th style="width: 5%;">跳数</th>
                    <th style="width: 35%;">IP 地址</th>
                    <th>地区</th>
                </tr>
            `;
            const tbody = document.createElement('tbody');
            let validHopCount = 0; // 记录有效跳数
            result.hops.forEach(hop => {
                // 检查 IP 是否为星号，如果不是则显示该行
                if (hop.ip && hop.ip !== '*') { 
                    const tr = document.createElement('tr');
                    const ipStr = hop.ip;
                    const locationStr = hop.location || '查询中...';
                    tr.innerHTML = `
                        <td>${hop.hop}</td>
                        <td>${ipStr}</td>
                        <td>${locationStr}</td>
                    `;
                    tbody.appendChild(tr);
                    validHopCount++;
                }
            });
            
            if(validHopCount > 0){
                table.appendChild(thead);
                table.appendChild(tbody);
                tableContainer.appendChild(table);
                cardBody.appendChild(tableContainer);
            } else {
                 // 如果所有跳都是星号或没有有效跳
                 cardBody.style.padding = '1.5rem';
                 cardBody.innerHTML = '<p class="text-muted">未能获取到有效的路由节点信息（可能全部超时）。</p>';
            }

        } else {
             cardBody.style.padding = '1.5rem';
            cardBody.innerHTML = '<p class="text-muted">未能获取到路由信息。</p>';
        }
        card.appendChild(cardHeader);
        card.appendChild(cardBody);
        col.appendChild(card);
        resultsContainer.appendChild(col);
    });
}
// --- 结束 路由追踪数据显示函数 ---

// 初始化页面 (修改调用)
async function initPage() {
    try {
        updateLoadingProgress(10, '正在初始化SQL.js...');
        await initializeSqlJs();
        
        updateLoadingProgress(30, '正在加载 Ping 数据库...');
        const success = await loadDatabase(); // loadDatabase 会设置全局 db 变量
        if (!success || !db) { // 检查 db 是否成功加载
            throw new Error('加载 Ping 数据库失败');
        }
        
        document.getElementById('loadingIndicator').style.display = 'none';
        document.getElementById('reportTabsContent').style.display = 'block';

        updateLoadingProgress(50, '正在分析 Ping 数据...');
        updateOverview();
        
        updateLoadingProgress(60, '正在生成 Ping 分析图表和控件...');
        populateTrendIpFilter(); 
        createLatencyDistributionChart();
        createTrendCharts(); 
        createStabilityHeatmap();
        updateAnomalyTable();
        createComparisonCharts();
        createUptimeChart();
        createJitterComparisonChart();

        const trendIpFilter = document.getElementById('trendIpFilter');
        if (trendIpFilter) {
            trendIpFilter.addEventListener('change', (event) => {
                createTrendCharts(event.target.value); 
            });
        }
        
        // --- 从数据库加载并显示路由追踪数据 ---
        updateLoadingProgress(85, '正在加载路由追踪数据...');
        // 直接调用新的函数，它会使用全局 db 对象
        await loadAndDisplayTracerouteFromDB(); 
        updateLoadingProgress(100, '报表加载完成。');
        
    } catch (err) {
        console.error('初始化页面失败:', err);
        const loadingIndicator = document.getElementById('loadingIndicator');
        loadingIndicator.innerHTML = `<div class="alert alert-danger" role="alert">页面加载失败: ${err.message}. <br>请确保 ping_data.db 文件存在且有效。</div>`;
        loadingIndicator.style.display = 'block'; 
        const contentArea = document.getElementById('reportTabsContent');
        if(contentArea) contentArea.style.display = 'none'; 
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initPage); 