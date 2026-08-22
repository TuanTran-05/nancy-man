import React from 'react';
import { Navigate } from 'react-router';
import LoadingScreen from '../components/common/LoadingScreen';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from './types';

export const ProtectedRoute = ({
  children,
  requiredRole,
  allowedRoles,
}: {
  children: React.ReactNode;
  requiredRole?: UserRole;
  allowedRoles?: UserRole[];
}) => {
  const { user, profile, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  if (!user || !profile) return <Navigate to="/login" />;

  if (requiredRole && profile.role !== requiredRole) {
    return <Navigate to="/" />;
  }
  if (allowedRoles && !allowedRoles.includes(profile.role as UserRole)) {
    return <Navigate to="/" />;
  }

  return <>{children}</>;
};
