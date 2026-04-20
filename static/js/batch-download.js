/**
 * 批量 Shapefile 下载模块
 * 处理多要素 Shapefile/GeoJSON 的独立下载调度
 */
(function() {
    'use strict';

    /**
     * 清理文件名，移除 Windows/macOS/Linux 禁用字符
     */
    function sanitizeFilename(name, fallbackIndex) {
        if (!name && name !== 0) return String(fallbackIndex).padStart(3, '0');
        let s = String(name)
            .replace(/\.(geojson|json|shp|shx|dbf|prj|zip)$/i, '')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/^\.+|\.+$/g, '')
            .substring(0, 100)
            .trim();
        return s || String(fallbackIndex).padStart(3, '0');
    }

    /**
     * 推荐命名字段：按优先级匹配常见属性名
     */
    function recommendNameField(keys) {
        const priorities = [
            '__source_file',
            'name', 'NAME', 'Name',
            'title', 'TITLE', 'Title',
            'id', 'ID', 'Id',
            'code', 'CODE', 'Code',
            'objectid', 'OBJECTID', 'fid', 'FID',
        ];
        for (const key of priorities) {
            if (keys.includes(key)) return key;
        }
        return keys[0] || null;
    }

    /**
     * 计算 Feature 的 bbox
     * 返回 {north, south, east, west} 或 null
     */
    function featureBbox(feature) {
        const coords = [];
        function collect(geom) {
            if (!geom) return;
            if (geom.type === 'Polygon') {
                geom.coordinates.forEach(ring => ring.forEach(c => coords.push(c)));
            } else if (geom.type === 'MultiPolygon') {
                geom.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(c => coords.push(c))));
            }
        }
        const geom = feature.type === 'Feature' ? feature.geometry : feature;
        collect(geom);
        if (coords.length === 0) return null;
        let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const [lng, lat] of coords) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
        return { north: maxLat, south: minLat, east: maxLng, west: minLng };
    }

    /**
     * 从 bbox 估算面积 (km^2)
     */
    function bboxAreaKm2(bbox) {
        const R = 6371;
        const latMid = (bbox.north + bbox.south) / 2 * Math.PI / 180;
        const dLat = (bbox.north - bbox.south) * Math.PI / 180;
        const dLng = (bbox.east - bbox.west) * Math.PI / 180;
        return Math.abs(R * R * dLat * dLng * Math.cos(latMid));
    }

    /**
     * 从单个 Feature 提取 polygon 坐标（用于裁剪）
     * 返回 [[{lat,lng},...], ...] 格式
     */
    function extractFeaturePolygon(feature) {
        const allRings = [];
        const geom = feature.type === 'Feature' ? feature.geometry : feature;
        if (!geom) return null;
        if (geom.type === 'Polygon') {
            allRings.push(geom.coordinates[0]);
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(p => allRings.push(p[0]));
        }
        if (allRings.length === 0) return null;
        return allRings.map(ring => ring.map(coord => ({ lat: coord[1], lng: coord[0] })));
    }

    /**
     * 去重文件名：重名自动追加 _N 后缀
     */
    function deduplicateFilenames(names) {
        const seen = {};
        return names.map(name => {
            if (!seen[name]) {
                seen[name] = 1;
                return name;
            }
            return `${name}_${seen[name]++}`;
        });
    }

    /**
     * 收集所有 Feature 的属性键（取并集），排除内部属性
     */
    function collectPropertyKeys(features) {
        const keysSet = new Set();
        features.forEach(f => {
            if (f.properties) {
                Object.keys(f.properties).forEach(k => {
                    if (!k.startsWith('__')) keysSet.add(k);
                });
            }
        });
        // 如果存在 __source_file，加入为可选命名字段
        const hasSourceFile = features.some(f => f.properties && f.properties.__source_file);
        const keys = Array.from(keysSet);
        if (hasSourceFile) keys.unshift('__source_file');
        return keys;
    }

    window.BatchDownload = {
        sanitizeFilename,
        recommendNameField,
        featureBbox,
        bboxAreaKm2,
        extractFeaturePolygon,
        deduplicateFilenames,
        collectPropertyKeys
    };
})();
