/*
 * Neburst Surge display panels
 * Read-only OpenAPI integration: overview, traffic, metrics, balance.
 */

(function () {
    "use strict";

    // SHA-256 hash of an empty request body. Neburst signs GET requests with SHA256("").
    var EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    var BASE_URL = "https://api.neburst.com";
    var API_PREFIX = "/open/v1";
    var REQUEST_GAP_MS = 5500;

    var ICONS = {
        overview: "server.rack",
        traffic: "arrow.up.arrow.down.circle",
        metrics: "waveform.path.ecg",
        balance: "creditcard",
        error: "exclamationmark.triangle",
        config: "gear.badge.questionmark",
        wait: "timer"
    };

    var COLORS = {
        green: "#50C878",
        yellow: "#FFD700",
        red: "#FF453A",
        orange: "#FF9F0A",
        blue: "#0A84FF",
        gray: "#8E8E93"
    };

    function parseArgs(input) {
        var args = {};
        if (!input) return args;
        input.split("&").forEach(function (item) {
            var index = item.indexOf("=");
            var key = index === -1 ? item : item.slice(0, index);
            var value = index === -1 ? "" : item.slice(index + 1);
            if (!key) return;
            args[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, "%20"));
        });
        return args;
    }

    function isMissing(value) {
        return !value || value === "必填" || value === "可留空" || String(value).indexOf("{{{") !== -1;
    }

    function normalizeMode(mode) {
        if (mode === "overview" || mode === "traffic" || mode === "metrics" || mode === "balance" || mode === "summary") return mode;
        return "traffic";
    }

    function normalizeType(type) {
        return type === "bare-metal" || type === "bare_metal" ? "bare-metal" : "instance";
    }

    function decodeCombinedKey(combinedKey) {
        var decoded = utf8FromBytes(base64ToBytes(String(combinedKey).trim()));
        var obj = JSON.parse(decoded);
        if (!obj.key_id || !obj.secret) throw new Error("combined key 缺少 key_id 或 secret");
        return obj;
    }

    function makeNonce() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = Math.floor(Math.random() * 16);
            var v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    function sortedQuery(query) {
        var keys = Object.keys(query || {}).filter(function (key) {
            return query[key] !== undefined && query[key] !== null && query[key] !== "";
        }).sort();
        return keys.map(function (key) {
            return encodeURIComponent(key) + "=" + encodeURIComponent(String(query[key]));
        }).join("&");
    }

    function makeSignedRequest(opts) {
        var queryString = sortedQuery(opts.query || {});
        var path = API_PREFIX + opts.endpoint;
        var body = opts.body || "";
        var timestamp = String(Math.floor(Date.now() / 1000));
        var nonce = makeNonce();
        var bodyHash = body ? sha256Hex(body) : EMPTY_SHA256;
        var stringToSign = [
            timestamp,
            opts.method,
            path,
            queryString,
            bodyHash
        ].join("\n");
        var signature = hmacSha256Hex(opts.secret, stringToSign);
        var url = BASE_URL + path + (queryString ? "?" + queryString : "");
        var headers = {
            "Accept": "application/json",
            "X-Nb-Key": opts.keyId,
            "X-Nb-Timestamp": timestamp,
            "X-Nb-Nonce": nonce,
            "X-Nb-Signature": signature
        };
        if (body) headers["Content-Type"] = "application/json";
        return { url: url, headers: headers, body: body, stringToSign: stringToSign, signature: signature };
    }

    function endpointFor(mode, type, id) {
        if (mode === "balance") return "/billing/balance";
        var root = type === "bare-metal" ? "/compute/bare-metal/" : "/compute/instance/";
        if (mode === "overview") return root + encodeURIComponent(id);
        if (mode === "traffic") return root + encodeURIComponent(id) + "/traffic";
        if (mode === "metrics") return root + encodeURIComponent(id) + "/metrics";
        return root + encodeURIComponent(id) + "/traffic";
    }

    function shouldThrottle(now) {
        if (typeof $persistentStore === "undefined") return false;
        var last = Number($persistentStore.read("neburst_last_request_at") || 0);
        if (last && now - last < REQUEST_GAP_MS) return true;
        markRequestAt(now);
        return false;
    }

    function markRequestAt(now) {
        if (typeof $persistentStore !== "undefined") {
            $persistentStore.write(String(now || Date.now()), "neburst_last_request_at");
        }
    }

    function requestJson(request, callback) {
        $httpClient.get({ url: request.url, headers: request.headers }, function (error, response, data) {
            if (error) {
                callback({ panel: panelError("网络请求失败", "wifi.exclamation", COLORS.red) });
                return;
            }
            var httpStatus = response && response.status ? response.status : 0;
            try {
                var obj = JSON.parse(data || "{}");
                if (httpStatus >= 400 && !obj.code) {
                    callback({ panel: panelError("HTTP " + httpStatus, ICONS.error, COLORS.red) });
                    return;
                }
                if (obj.code !== 0) {
                    callback({ panel: apiErrorPanel(obj.code, obj.msg) });
                    return;
                }
                callback({ data: obj.data, response: response });
            } catch (e) {
                callback({ panel: panelError("解析异常", "terminal", COLORS.red) });
            }
        });
    }

    function apiErrorPanel(code, msg) {
        var messageMap = {
            58200: "签名失败，请检查 API Key",
            58201: "时间偏移，请检查设备时间",
            58203: "权限不足，请补充 API scope",
            58204: "请求过快，请降低刷新频率"
        };
        var text = messageMap[code] || ("错误 " + code + (msg ? "：" + msg : ""));
        return panelError(text, ICONS.error, code === 58204 ? COLORS.orange : COLORS.red);
    }

    function panelError(content, icon, color) {
        return { title: "Neburst", content: content, icon: icon || ICONS.error, iconColor: color || COLORS.red };
    }

    function prefixedTitle(prefix, label) {
        return prefix ? prefix + " " + label : label;
    }

    function renderPanel(mode, titlePrefix, data) {
        if (mode === "overview") return renderOverview(titlePrefix, data);
        if (mode === "traffic") return renderTraffic(titlePrefix, data);
        if (mode === "metrics") return renderMetrics(titlePrefix, data);
        if (mode === "balance") return renderBalance(titlePrefix, data);
        return panelError("未知展示模式", ICONS.error, COLORS.orange);
    }

    function renderOverview(titlePrefix, d) {
        d = d || {};
        var status = d.status || "-";
        var powerColor = statusColor(status);
        var specs = d.specs || {};
        var specLine = [];
        if (specs.cpu_cores) specLine.push(specs.cpu_cores + "C");
        if (specs.memory_gb) specLine.push(specs.memory_gb + "GB");
        if (specs.network_speed_gbps) specLine.push(specs.network_speed_gbps + "Gbps");
        var content = [
            "名称：" + fallback(d.name),
            "状态：" + status,
            "IP：" + fallback(d.primary_ipv4),
            "地区：" + fallback(d.region),
            "系统：" + fallback(d.os_name),
            "规格：" + (specLine.length ? specLine.join(" / ") : "-"),
            "续费：" + formatDate(d.next_pay_at) + " / " + (d.auto_renew ? "自动" : "手动")
        ].join("\n");
        return {
            title: prefixedTitle(titlePrefix, "实例概览"),
            content: content,
            icon: ICONS.overview,
            iconColor: powerColor
        };
    }

    function renderSummary(titlePrefix, sections) {
        var content = sections.map(function (section) {
            return section.label + "\n" + section.content;
        }).join("\n\n");
        return {
            title: prefixedTitle(titlePrefix, "综合监控"),
            content: content || "未选择任何展示项",
            icon: ICONS.overview,
            iconColor: summaryColor(sections)
        };
    }

    function summaryColor(sections) {
        var colors = sections.map(function (section) { return section.iconColor; });
        if (colors.indexOf(COLORS.red) !== -1) return COLORS.red;
        if (colors.indexOf(COLORS.yellow) !== -1 || colors.indexOf(COLORS.orange) !== -1) return COLORS.yellow;
        if (colors.indexOf(COLORS.green) !== -1) return COLORS.green;
        return COLORS.blue;
    }

    function summaryLabel(mode) {
        if (mode === "overview") return "实例概览";
        if (mode === "traffic") return "流量监控";
        if (mode === "metrics") return "资源监控";
        if (mode === "balance") return "账户余额";
        return mode;
    }

    function shouldShow(value, defaultValue) {
        if (value === undefined || value === null || value === "") return defaultValue;
        var text = String(value).toLowerCase();
        return text === "1" || text === "true" || text === "yes" || text === "on" || text === "show" || text === "显示";
    }

    function selectedSummaryModes(args) {
        var modes = [];
        if (shouldShow(args.show_overview, true)) modes.push("overview");
        if (shouldShow(args.show_traffic, true)) modes.push("traffic");
        if (shouldShow(args.show_metrics, true)) modes.push("metrics");
        if (shouldShow(args.show_balance, true)) modes.push("balance");
        return modes;
    }

    function modeNeedsId(mode) {
        return mode === "overview" || mode === "traffic" || mode === "metrics";
    }

    function selectedModesNeedId(modes) {
        return modes.some(modeNeedsId);
    }

    function runSummary(args, key, type, title) {
        var modes = selectedSummaryModes(args);
        if (!modes.length) {
            $done(renderSummary(title, []));
            return;
        }

        var sections = [];
        var index = 0;

        function next() {
            if (index >= modes.length) {
                $done(renderSummary(title, sections));
                return;
            }

            var mode = modes[index++];
            var endpoint = endpointFor(mode, type, args.id);
            var request = makeSignedRequest({
                method: "GET",
                endpoint: endpoint,
                query: {},
                keyId: key.key_id,
                secret: key.secret
            });

            markRequestAt(Date.now());
            requestJson(request, function (result) {
                if (result.panel) {
                    sections.push({
                        label: summaryLabel(mode),
                        content: result.panel.content,
                        iconColor: result.panel.iconColor
                    });
                } else {
                    var panel = renderPanel(mode, "", result.data);
                    sections.push({
                        label: summaryLabel(mode),
                        content: panel.content,
                        iconColor: panel.iconColor
                    });
                }

                if (index < modes.length && typeof setTimeout !== "undefined") {
                    setTimeout(next, REQUEST_GAP_MS);
                } else {
                    next();
                }
            });
        }

        next();
    }

    function renderTraffic(titlePrefix, d) {
        var packages = d && d.packages && d.packages.length ? d.packages : [];
        if (!packages.length) {
            return {
                title: prefixedTitle(titlePrefix, "流量监控"),
                content: "暂无流量包数据",
                icon: ICONS.traffic,
                iconColor: COLORS.gray
            };
        }

        var total = 0;
        var used = 0;
        packages.forEach(function (pkg) {
            total += Number(pkg.capacity_gb || 0);
            used += Number(pkg.used_gb || 0);
        });
        var free = Math.max(total - used, 0);
        var percent = total > 0 ? used / total * 100 : 0;
        var first = packages[0] || {};
        var content = [
            "已用：" + formatGb(used) + " / " + formatGb(total),
            "剩余：" + formatGb(free),
            "占比：" + formatPercent(percent),
            "周期：" + fallback(first.reset_cycle)
        ].join("\n");
        return {
            title: prefixedTitle(titlePrefix, "流量监控"),
            content: content,
            icon: ICONS.traffic,
            iconColor: colorByPercent(percent)
        };
    }

    function renderMetrics(titlePrefix, d) {
        d = d || {};
        var cpu = d.cpu || {};
        var memory = d.memory || {};
        var disk = d.disk || {};
        var bandwidth = d.bandwidth || {};
        var network = d.network || {};
        var worst = maxNumber([
            cpu.percentage,
            memory.percentage,
            disk.percentage,
            bandwidth.percentage
        ]);
        var content = [
            "CPU：" + formatPercent(cpu.percentage),
            "内存：" + formatUsage(memory.usage, memory.limit, memory.unit, memory.percentage),
            "磁盘：" + formatUsage(disk.usage, disk.limit, disk.unit, disk.percentage),
            "流量：" + formatUsage(bandwidth.usage, bandwidth.limit, bandwidth.limit_unit || bandwidth.usage_unit, bandwidth.percentage),
            "网络：" + formatSpeed(network.inbound, network.outbound, network.unit),
            "周期结束：" + formatDate(bandwidth.end_time)
        ].join("\n");
        return {
            title: prefixedTitle(titlePrefix, "资源监控"),
            content: content,
            icon: ICONS.metrics,
            iconColor: colorByPercent(worst)
        };
    }

    function renderBalance(titlePrefix, d) {
        d = d || {};
        var currency = d.currency || "USD";
        var content = [
            "可用：" + formatMoney(d.available, currency),
            "锁定：" + formatMoney(d.locked, currency),
            "币种：" + currency
        ].join("\n");
        return {
            title: prefixedTitle(titlePrefix, "账户余额"),
            content: content,
            icon: ICONS.balance,
            iconColor: COLORS.blue
        };
    }

    function statusColor(status) {
        var s = String(status || "").toLowerCase();
        if (s === "running" || s === "allocated" || s === "on") return COLORS.green;
        if (s === "stopped" || s === "off") return COLORS.orange;
        if (s === "error" || s === "failed" || s === "terminated") return COLORS.red;
        return COLORS.yellow;
    }

    function colorByPercent(percent) {
        var p = Number(percent || 0);
        if (p > 90) return COLORS.red;
        if (p > 75) return COLORS.yellow;
        return COLORS.green;
    }

    function fallback(value) {
        return value === undefined || value === null || value === "" ? "-" : String(value);
    }

    function maxNumber(values) {
        var result = 0;
        values.forEach(function (value) {
            var n = Number(value);
            if (!isNaN(n) && n > result) result = n;
        });
        return result;
    }

    function formatNumber(value, digits) {
        var n = Number(value);
        if (isNaN(n)) return "-";
        return n.toFixed(digits === undefined ? 2 : digits).replace(/\.?0+$/, "");
    }

    function formatGb(value) {
        var n = Number(value);
        if (isNaN(n)) return "-";
        if (n >= 1024) return formatNumber(n / 1024, 2) + " TB";
        return formatNumber(n, 2) + " GB";
    }

    function formatPercent(value) {
        var n = Number(value);
        if (isNaN(n)) return "-";
        return formatNumber(n, 1) + "%";
    }

    function formatUsage(usage, limit, unit, percent) {
        if (usage === undefined && limit === undefined && percent === undefined) return "-";
        var left = formatNumber(usage, 2) + " / " + formatNumber(limit, 2);
        if (unit) left += " " + unit;
        return left + " (" + formatPercent(percent) + ")";
    }

    function formatSpeed(inbound, outbound, unit) {
        var u = unit || "Mbps";
        return "↓ " + formatNumber(inbound, 2) + " " + u + " / ↑ " + formatNumber(outbound, 2) + " " + u;
    }

    function formatMoney(value, currency) {
        var n = Number(value);
        if (isNaN(n)) return "-";
        return formatNumber(n, 2) + " " + currency;
    }

    function formatDate(value) {
        if (!value) return "-";
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return (d.getMonth() + 1) + "月" + d.getDate() + "日";
    }

    function bytesFromUtf8(input) {
        var str = String(input);
        var bytes = [];
        for (var i = 0; i < str.length; i++) {
            var code = str.charCodeAt(i);
            if (code < 0x80) {
                bytes.push(code);
            } else if (code < 0x800) {
                bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            } else if (code >= 0xd800 && code <= 0xdbff) {
                i++;
                var next = str.charCodeAt(i);
                var point = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff));
                bytes.push(
                    0xf0 | (point >> 18),
                    0x80 | ((point >> 12) & 0x3f),
                    0x80 | ((point >> 6) & 0x3f),
                    0x80 | (point & 0x3f)
                );
            } else {
                bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            }
        }
        return bytes;
    }

    function utf8FromBytes(bytes) {
        var result = "";
        for (var i = 0; i < bytes.length;) {
            var b = bytes[i++];
            if (b < 0x80) {
                result += String.fromCharCode(b);
            } else if (b < 0xe0) {
                result += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
            } else if (b < 0xf0) {
                result += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
            } else {
                var point = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
                point -= 0x10000;
                result += String.fromCharCode(0xd800 + (point >> 10), 0xdc00 + (point & 0x3ff));
            }
        }
        return result;
    }

    function base64ToBytes(input) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var clean = String(input).replace(/[\r\n\s]/g, "").replace(/=+$/, "");
        var bytes = [];
        var buffer = 0;
        var bits = 0;
        for (var i = 0; i < clean.length; i++) {
            var value = chars.indexOf(clean.charAt(i));
            if (value < 0) throw new Error("无效 Base64 API Key");
            buffer = (buffer << 6) | value;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                bytes.push((buffer >> bits) & 0xff);
            }
        }
        return bytes;
    }

    function hexFromBytes(bytes) {
        return bytes.map(function (b) {
            return (b < 16 ? "0" : "") + b.toString(16);
        }).join("");
    }

    function bytesFromWords(words, bitLength) {
        var bytes = [];
        for (var i = 0; i < bitLength / 8; i++) {
            bytes.push((words[i >> 2] >>> (24 - (i % 4) * 8)) & 0xff);
        }
        return bytes;
    }

    function sha256Bytes(inputBytes) {
        var K = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ];
        var H = [
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
        ];
        var bytes = inputBytes.slice();
        var bitLength = bytes.length * 8;
        bytes.push(0x80);
        while ((bytes.length % 64) !== 56) bytes.push(0);
        var high = Math.floor(bitLength / 0x100000000);
        var low = bitLength >>> 0;
        bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff);
        bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);

        for (var offset = 0; offset < bytes.length; offset += 64) {
            var W = new Array(64);
            for (var i = 0; i < 16; i++) {
                W[i] = (
                    (bytes[offset + i * 4] << 24) |
                    (bytes[offset + i * 4 + 1] << 16) |
                    (bytes[offset + i * 4 + 2] << 8) |
                    (bytes[offset + i * 4 + 3])
                ) >>> 0;
            }
            for (i = 16; i < 64; i++) {
                var s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
                var s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
                W[i] = add32(W[i - 16], s0, W[i - 7], s1);
            }
            var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
            for (i = 0; i < 64; i++) {
                var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                var ch = (e & f) ^ (~e & g);
                var temp1 = add32(h, S1, ch, K[i], W[i]);
                var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                var maj = (a & b) ^ (a & c) ^ (b & c);
                var temp2 = add32(S0, maj);
                h = g;
                g = f;
                f = e;
                e = add32(d, temp1);
                d = c;
                c = b;
                b = a;
                a = add32(temp1, temp2);
            }
            H[0] = add32(H[0], a);
            H[1] = add32(H[1], b);
            H[2] = add32(H[2], c);
            H[3] = add32(H[3], d);
            H[4] = add32(H[4], e);
            H[5] = add32(H[5], f);
            H[6] = add32(H[6], g);
            H[7] = add32(H[7], h);
        }
        return bytesFromWords(H, 256);
    }

    function rotr(x, n) {
        return (x >>> n) | (x << (32 - n));
    }

    function add32() {
        var result = 0;
        for (var i = 0; i < arguments.length; i++) result = (result + (arguments[i] >>> 0)) >>> 0;
        return result;
    }

    function sha256Hex(input) {
        return hexFromBytes(sha256Bytes(bytesFromUtf8(input)));
    }

    function hmacSha256Hex(key, message) {
        var blockSize = 64;
        var keyBytes = bytesFromUtf8(key);
        if (keyBytes.length > blockSize) keyBytes = sha256Bytes(keyBytes);
        while (keyBytes.length < blockSize) keyBytes.push(0);

        var oKey = [];
        var iKey = [];
        for (var i = 0; i < blockSize; i++) {
            oKey[i] = keyBytes[i] ^ 0x5c;
            iKey[i] = keyBytes[i] ^ 0x36;
        }
        var inner = sha256Bytes(iKey.concat(bytesFromUtf8(message)));
        return hexFromBytes(sha256Bytes(oKey.concat(inner)));
    }

    function runSurge(argument) {
        var args = parseArgs(argument);
        var mode = normalizeMode(args.mode);
        var type = normalizeType(args.type);
        var title = args.title || "Neburst";
        var summaryModes = mode === "summary" ? selectedSummaryModes(args) : [];

        if (isMissing(args.api_key)) {
            return {
                title: prefixedTitle(title, "配置错误"),
                content: "请填写 Neburst API Key",
                icon: ICONS.config,
                iconColor: COLORS.orange
            };
        }

        if ((mode !== "summary" && mode !== "balance" && isMissing(args.id)) || (mode === "summary" && selectedModesNeedId(summaryModes) && isMissing(args.id))) {
            return {
                title: prefixedTitle(title, "配置错误"),
                content: "请填写实例 UUID",
                icon: ICONS.config,
                iconColor: COLORS.orange
            };
        }

        var key;
        try {
            key = decodeCombinedKey(args.api_key);
        } catch (e) {
            return {
                title: prefixedTitle(title, "配置错误"),
                content: e.message || "API Key 解析失败",
                icon: ICONS.config,
                iconColor: COLORS.orange
            };
        }

        if (shouldThrottle(Date.now())) {
            return {
                title: prefixedTitle(title, "限流保护"),
                content: "距离上次请求不足 5 秒，请稍后刷新",
                icon: ICONS.wait,
                iconColor: COLORS.orange
            };
        }

        if (mode === "summary") {
            runSummary(args, key, type, title);
            return null;
        }

        var endpoint = endpointFor(mode, type, args.id);
        var request = makeSignedRequest({
            method: "GET",
            endpoint: endpoint,
            query: {},
            keyId: key.key_id,
            secret: key.secret
        });

        requestJson(request, function (result) {
            if (result.panel) {
                result.panel.title = result.panel.title === "Neburst" ? prefixedTitle(title, "请求失败") : result.panel.title;
                $done(result.panel);
                return;
            }
            $done(renderPanel(mode, title, result.data));
        });

        return null;
    }

    var api = {
        parseArgs: parseArgs,
        decodeCombinedKey: decodeCombinedKey,
        sortedQuery: sortedQuery,
        makeSignedRequest: makeSignedRequest,
        endpointFor: endpointFor,
        renderPanel: renderPanel,
        renderSummary: renderSummary,
        selectedSummaryModes: selectedSummaryModes,
        sha256Hex: sha256Hex,
        hmacSha256Hex: hmacSha256Hex,
        _format: {
            formatGb: formatGb,
            formatPercent: formatPercent,
            formatDate: formatDate
        }
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    if (typeof $done !== "undefined") {
        var immediate = runSurge(typeof $argument === "undefined" ? "" : $argument);
        if (immediate) $done(immediate);
    }
}());
