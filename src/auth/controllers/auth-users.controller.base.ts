import { Delete, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { GetUsersFilterDto } from '../dto/get-users-filter.dto';
import { GetUsersResponseDto } from '../dto/get-users-response.dto';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { AuthPasswordControllerBase } from './auth-password.controller.base';

export abstract class AuthUsersControllerBase extends AuthPasswordControllerBase {
  @Get('users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get all users with filtering',
    description: 'Retrieves all users with optional filtering by role, active status, and search. Requires super admin authentication. Supports pagination and sorting.',
  })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully', type: GetUsersResponseDto })
  @ApiResponse({ status: 403, description: 'Only super admins can view all users' })
  @ApiResponse({ status: 401, description: 'Authentication token is missing or invalid' })
  async getUsers(@Query() filters: GetUsersFilterDto, @Request() req: any) {
    return this.authService.getAllUsers(req.user, filters);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete a user',
    description: 'Allows the authenticated user to delete their own account or allows a super admin to delete any user account.',
  })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 403, description: 'Only a super admin can delete another user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deleteUser(@Param('id') id: string, @Request() req: any) {
    await this.authService.deleteUser(id, req.user);
    return { message: 'User deleted successfully' };
  }
}
