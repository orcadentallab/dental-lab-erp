const express = require('express');
const router = express.Router();

// Sample data (replace with database later)
let orders = [
    { id: 1, patientName: 'أحمد محمد', doctorId: 1, status: 'new', createdAt: new Date() },
    { id: 2, patientName: 'سارة علي', doctorId: 2, status: 'in_progress', createdAt: new Date() },
];

// GET all orders
router.get('/', (req, res) => {
    res.json({ success: true, data: orders });
});

// GET single order
router.get('/:id', (req, res) => {
    const order = orders.find(o => o.id === parseInt(req.params.id));
    if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.json({ success: true, data: order });
});

// POST create order
router.post('/', (req, res) => {
    const newOrder = {
        id: orders.length + 1,
        ...req.body,
        createdAt: new Date()
    };
    orders.push(newOrder);
    res.status(201).json({ success: true, data: newOrder });
});

// PUT update order
router.put('/:id', (req, res) => {
    const index = orders.findIndex(o => o.id === parseInt(req.params.id));
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'Order not found' });
    }
    orders[index] = { ...orders[index], ...req.body };
    res.json({ success: true, data: orders[index] });
});

// DELETE order
router.delete('/:id', (req, res) => {
    const index = orders.findIndex(o => o.id === parseInt(req.params.id));
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const deleted = orders.splice(index, 1);
    res.json({ success: true, data: deleted[0] });
});

module.exports = router;
