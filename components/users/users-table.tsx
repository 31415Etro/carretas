"use client"

import type React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { User, UserRole } from "@/lib/types"
import { Edit, Trash2, Shield, UserCircle, Target, Users } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface UsersTableProps {
  users: User[]
  onEdit: (user: User) => void
  onDelete: (userId: string) => void
  onManageTargets?: (user: User) => void
  onManageRepresentatives?: (user: User) => void
}

const roleColors: Record<UserRole, string> = {
  admin: "bg-red-100 text-red-700 border-red-200",
  sdr: "bg-blue-100 text-blue-700 border-blue-200",
  closer: "bg-green-100 text-green-700 border-green-200",
  representative: "bg-purple-100 text-purple-700 border-purple-200",
  manager: "bg-orange-100 text-orange-700 border-orange-200", // Added manager role color
  sd: "bg-teal-100 text-teal-700 border-teal-200", // Added SD role color
  client: "bg-cyan-100 text-cyan-700 border-cyan-200",
  user: "bg-slate-100 text-slate-700 border-slate-200",
}

const roleIcons: Record<UserRole, React.ReactNode> = {
  admin: <Shield className="h-3 w-3" />,
  sdr: <UserCircle className="h-3 w-3" />,
  closer: <UserCircle className="h-3 w-3" />,
  representative: <UserCircle className="h-3 w-3" />,
  manager: <Shield className="h-3 w-3" />, // Added manager role icon
  sd: <UserCircle className="h-3 w-3" />, // Added SD role icon
  client: <Users className="h-3 w-3" />,
  user: <UserCircle className="h-3 w-3" />,
}

export function UsersTable({ users, onEdit, onDelete, onManageTargets, onManageRepresentatives }: UsersTableProps) {
  const { toast } = useToast()

  const handleDelete = (userId: string, userName: string) => {
    if (confirm(`Are you sure you want to delete user ${userName}?`)) {
      onDelete(userId)
      toast({
        title: "User deleted",
        description: `${userName} has been removed from the system`,
      })
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="max-h-[35rem] overflow-auto overscroll-contain [scrollbar-gutter:stable]">
        <table className="w-full">
          <thead className="sticky top-0 z-20 bg-muted border-b border-border">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Telefone
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Vinculo
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Permissions
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div>
                    <div className="font-medium text-foreground">{user.name}</div>
                    <div className="text-sm text-muted-foreground">{user.email}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-muted-foreground">{(user as any).phone || "-"}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <Badge variant="outline" className={roleColors[user.role]}>
                    <span className="flex items-center gap-1">
                      {roleIcons[user.role]}
                      {user.role.toUpperCase()}
                    </span>
                  </Badge>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {user.role === "client" && user.client ? (
                    <div className="text-sm font-medium text-foreground">{user.client.name}</div>
                  ) : user.role === "representative" && user.manager ? (
                    <div className="text-sm">
                      <div className="text-foreground font-medium">{user.manager.full_name}</div>
                      <div className="text-muted-foreground text-xs">{user.manager.email}</div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-muted-foreground">{user.permissions.length} pages</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <Badge variant={user.active ? "default" : "secondary"}>{user.active ? "Active" : "Inactive"}</Badge>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="flex items-center justify-end gap-2">
                    {onManageRepresentatives && user.role === "manager" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onManageRepresentatives(user)}
                        className="h-8 gap-1.5"
                      >
                        <Users className="h-3.5 w-3.5" />
                        Representantes
                      </Button>
                    )}
                    {onManageTargets &&
                      (user.role === "admin" ||
                        user.role === "sdr" ||
                        user.role === "closer" ||
                        user.role === "representative" ||
                        user.role === "manager" ||
                        user.role === "sd") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onManageTargets(user)}
                          className="h-8 gap-1.5"
                        >
                          <Target className="h-3.5 w-3.5" />
                          Metas
                        </Button>
                      )}
                    <Button variant="ghost" size="icon" onClick={() => onEdit(user)} className="h-8 w-8">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Excluir usuario"
                      onClick={() => handleDelete(user.id, user.name)}
                      className="h-8 w-8 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
