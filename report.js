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

// 创建趋势图
function createTrendCharts() {
    // 延迟趋势
    const latencyQuery = `
        SELECT 
            strftime('%Y-%m-%d', timestamp) as date, /* 使用strftime确保日期格式一致 */
            AVG(avg_latency) as avg_latency
        FROM ping_results
        WHERE timestamp >= datetime('now', '-30 days') AND avg_latency IS NOT NULL
        GROUP BY date
        ORDER BY date
    `;
    
    try {
        const latencyResult = db.exec(latencyQuery)[0];
        if (latencyResult && latencyResult.values && latencyResult.values.length > 0) {
            const ctx = document.getElementById('latencyTrendChart').getContext('2d');
            if (charts.latencyTrend) charts.latencyTrend.destroy();
            charts.latencyTrend = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: latencyResult.values.map(row => row[0]),
                    datasets: [{
                        label: '平均延迟',
                        data: latencyResult.values.map(row => Math.round(row[1] || 0)),
                        borderColor: 'rgba(54, 162, 235, 1)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)', // 添加背景色
                        tension: 0.1,
                        fill: true // 填充区域
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: false, // Y轴不一定从0开始
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
             console.warn("No data for latency trend chart.");
        }
    } catch (e) {
        console.error("Error creating latency trend chart:", e);
    }
    
    // 丢包率趋势
    const packetLossQuery = `
        SELECT 
            strftime('%Y-%m-%d', timestamp) as date, /* 使用strftime确保日期格式一致 */
            AVG(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100 as packet_loss
        FROM ping_results
        WHERE timestamp >= datetime('now', '-30 days')
        GROUP BY date
        ORDER BY date
    `;
    
    try {
        const packetLossResult = db.exec(packetLossQuery)[0];
        if (packetLossResult && packetLossResult.values && packetLossResult.values.length > 0) {
            const ctx = document.getElementById('packetLossTrendChart').getContext('2d');
            if (charts.packetLossTrend) charts.packetLossTrend.destroy();
            charts.packetLossTrend = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: packetLossResult.values.map(row => row[0]),
                    datasets: [{
                        label: '丢包率',
                        data: packetLossResult.values.map(row => (row[1] || 0).toFixed(1)),
                        borderColor: 'rgba(255, 99, 132, 1)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)', // 添加背景色
                        tension: 0.1,
                        fill: true // 填充区域
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100, // Y轴最大值100%
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
             console.warn("No data for packet loss trend chart.");
        }
     } catch (e) {
        console.error("Error creating packet loss trend chart:", e);
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

// 初始化页面
async function initPage() {
    try {
        updateLoadingProgress(10, '正在初始化SQL.js...');
        await initializeSqlJs(); // 使用重命名后的函数
        
        updateLoadingProgress(30, '正在加载数据库...');
        const success = await loadDatabase();
        if (!success) {
            throw new Error('加载数据库失败');
        }
        
        // 隐藏加载指示器，显示内容
        document.getElementById('loadingIndicator').style.display = 'none';
        document.getElementById('reportTabsContent').style.display = 'block'; // 确保内容可见

        updateLoadingProgress(50, '正在分析数据...');
        updateOverview();
        
        updateLoadingProgress(60, '正在生成图表...');
        createLatencyDistributionChart();
        createTrendCharts();
        createStabilityHeatmap();
        updateAnomalyTable();
        createComparisonCharts();
        
        // updateLoadingProgress(100, '加载完成'); // 加载完成不再需要进度条
        
    } catch (err) {
        console.error('初始化页面失败:', err);
        const loadingIndicator = document.getElementById('loadingIndicator');
        loadingIndicator.innerHTML = `<div class="alert alert-danger" role="alert">加载失败: ${err.message}</div>`;
        // 确保错误信息可见
        loadingIndicator.style.display = 'block'; 
        document.getElementById('reportTabsContent').style.display = 'none'; // 隐藏内容区域
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initPage); 