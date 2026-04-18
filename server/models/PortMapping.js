const mongoose = require('mongoose');

const PortMappingSchema = new mongoose.Schema({
    deploymentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Deployment',
        required: true,
        unique: true,
        index: true
    },
    containerPort: {
        type: Number,
        required: true,
        unique: true,
        min: 3001,
        max: 4000
    },
    subdomain: {
        type: String,
        sparse: true
    },
    nodeId: {
        type: String,
        index: true
    },
    status: {
        type: String,
        enum: ['active', 'released', 'failed'],
        default: 'active'
    },
    allocatedAt: {
        type: Date,
        default: Date.now
    },
    releasedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Index for efficient querying
PortMappingSchema.index({ status: 1, allocatedAt: -1 });
PortMappingSchema.index({ nodeId: 1, status: 1 });

module.exports = mongoose.model('PortMapping', PortMappingSchema);
