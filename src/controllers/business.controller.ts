import httpStatus from 'http-status';
import {businessService} from '@services/index';
import {tenantOf} from '@middlewares/auth.middleware';
import {catchAsync, ApiResponse} from '@utils/index';
import {businessValidation, commonValidation} from '@validations/index';

// The tenant always comes from the authenticated session (tenantOf), never from the request.

const getBusiness = catchAsync(async (req, res) => {
    const business = await businessService.getBusiness(tenantOf(req).kiranaId);
    res.status(httpStatus.OK).json(new ApiResponse(httpStatus.OK, business, 'Business'));
});

const updateBusiness = catchAsync(async (req, res) => {
    const data = businessValidation.updateBusinessSchema.parse(req.body);
    const business = await businessService.updateBusiness(tenantOf(req).kiranaId, data);
    res.status(httpStatus.OK).json(new ApiResponse(httpStatus.OK, business, 'Business updated'));
});

const listMembers = catchAsync(async (req, res) => {
    const members = await businessService.listMembers(tenantOf(req).kiranaId);
    res.status(httpStatus.OK).json(new ApiResponse(httpStatus.OK, members, 'Members'));
});

const addMember = catchAsync(async (req, res) => {
    const data = businessValidation.addMemberSchema.parse(req.body);
    const {kiranaId, membershipRole} = tenantOf(req);
    const member = await businessService.addMember(kiranaId, membershipRole, data);
    res.status(httpStatus.CREATED).json(
        new ApiResponse(httpStatus.CREATED, member, 'Member added'),
    );
});

const updateMember = catchAsync(async (req, res) => {
    const id = commonValidation.idSchema.parse(req.params.id);
    const data = businessValidation.updateMemberSchema.parse(req.body);
    const actor = tenantOf(req);
    const member = await businessService.updateMember(actor.kiranaId, actor, id, data);
    res.status(httpStatus.OK).json(new ApiResponse(httpStatus.OK, member, 'Member updated'));
});

export default {getBusiness, updateBusiness, listMembers, addMember, updateMember};
